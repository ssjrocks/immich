import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Insertable, Selectable, Updateable } from 'kysely';
import _ from 'lodash';
import { Person } from 'src/database';
import { Chunked, OnJob } from 'src/decorators';
import { BulkIdErrorReason, BulkIdResponseDto, BulkIdsDto } from 'src/dtos/asset-ids.response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  AssetFaceCreateDto,
  AssetFaceDeleteDto,
  AssetFaceResponseDto,
  AssetFaceUpdateDto,
  FaceDto,
  mapFaces,
  mapPerson,
  MergePersonDto,
  PeopleResponseDto,
  PeopleUpdateDto,
  PersonCreateDto,
  PersonResponseDto,
  PersonSearchDto,
  PersonStatisticsResponseDto,
  PersonUnassignFromAssetDto,
  PersonUpdateDto,
  PersonVideoOccurrenceResponseDto,
} from 'src/dtos/person.dto';
import {
  AssetType,
  AssetVisibility,
  CacheControl,
  JobName,
  JobStatus,
  Permission,
  PersonPathType,
  QueueName,
  SourceType,
  SystemMetadataKey,
  VectorIndex,
  VideoFaceSamplingMethod,
} from 'src/enum';
import { BoundingBox } from 'src/repositories/machine-learning.repository';
import { VideoFrameSampling } from 'src/repositories/media.repository';
import { PersonId, UpdateFacesData } from 'src/repositories/person.repository';
import { DB } from 'src/schema/index';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table';
import { FaceSearchTable } from 'src/schema/tables/face-search.table';
import { PersonTable } from 'src/schema/tables/person.table';
import { BaseService } from 'src/services/base.service';
import type { JobItem, JobOf } from 'src/types';
import { getDimensions } from 'src/utils/asset.util';
import { ImmichFileResponse } from 'src/utils/file';
import { mimeTypes } from 'src/utils/mime-types';
import {
  batched,
  findOrFail,
  isFacialRecognitionEnabled,
  isVideoFaceDetectionDisabled,
  isVideoFaceScanEnabled,
} from 'src/utils/misc';
import { getPreferences } from 'src/utils/preferences';
import { Point, transformPoints } from 'src/utils/transform';
import { groupIntoAppearances } from 'src/utils/video-appearance';
import { groupVideoFaces } from 'src/utils/video-face-groups';

const personKey = ({ ownerId, personGroupId }: PersonId) => `${ownerId}/${personGroupId}`;

// How many of a video face group's clearest faces are searched against the library for an existing person.
const VIDEO_GROUP_MATCH_ATTEMPTS = 3;

const mostCommonPersonGroupId = (faces: { personGroupId: string | null }[]) => {
  const counts = new Map<string, number>();
  for (const { personGroupId } of faces) {
    if (personGroupId) {
      counts.set(personGroupId, (counts.get(personGroupId) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

@Injectable()
export class PersonService extends BaseService {
  async getAll(auth: AuthDto, dto: PersonSearchDto): Promise<PeopleResponseDto> {
    const { withHidden = false, closestAssetId, closestPersonId, page, size } = dto;
    let closestFaceAssetId = closestAssetId;
    const pagination = {
      take: size,
      skip: (page - 1) * size,
    };

    if (closestPersonId) {
      const person = await this.personRepository.getByGroupId({
        ownerId: auth.user.id,
        personGroupId: closestPersonId,
      });
      if (!person) {
        throw new NotFoundException('Person not found');
      }
      // Their feature face is nulled out when that face is deleted and nothing repairs it, so
      // requiring one here 404s the merge screen for people who still have plenty of faces. Fall
      // back to any face they do have.
      const fallbackFace = person.faceAssetId ? undefined : await this.personRepository.getRandomFace(closestPersonId);
      closestFaceAssetId = person.faceAssetId ?? fallbackFace?.id;
      if (!closestFaceAssetId) {
        throw new NotFoundException('Person not found');
      }
    }
    const { items, hasNextPage } = await this.personRepository.getAllForUser(pagination, auth.user.id, {
      withHidden,
      closestFaceAssetId,
      // Merging into a named person (closestPersonId) should keep named people bucketed first;
      // "wrong person" reassignment (closestAssetId) wants a pure similarity ranking so the true
      // match -- named or not -- comes out on top.
      preferNamedFirst: !!closestPersonId,
    });
    const { total, hidden } = await this.personRepository.getNumberOfPeople(auth.user.id);

    return {
      people: items.map((person) => mapPerson(person)),
      hasNextPage,
      total,
      hidden,
    };
  }

  async reassignFaces(auth: AuthDto, personGroupId: string, dto: AssetFaceUpdateDto): Promise<PersonResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personGroupId] });
    const person = await this.findOrFail(auth, personGroupId);
    const result: PersonResponseDto[] = [];
    const changeFeaturePhoto = new Map<string, PersonId>();
    for (const data of dto.data) {
      const faces = await this.personRepository.getFacesByIds(
        [{ personGroupId: data.personId, assetId: data.assetId }],
        { viewingUserId: auth.user.id },
      );

      for (const face of faces) {
        await this.requireAccess({ auth, permission: Permission.PersonCreate, ids: [face.id] });
        if (person.faceAssetId === null) {
          changeFeaturePhoto.set(personKey(person), person);
        }
        if (face.person && face.person.faceAssetId === face.id) {
          changeFeaturePhoto.set(personKey(face.person), face.person);
        }

        await this.personRepository.reassignFace(face.id, person.personGroupId);
      }

      result.push(mapPerson(person));
    }
    if (changeFeaturePhoto.size > 0) {
      await this.createNewFeaturePhoto(changeFeaturePhoto.values().toArray());
    }
    return result;
  }

  async reassignFacesById(auth: AuthDto, personGroupId: string, dto: FaceDto): Promise<PersonResponseDto> {
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personGroupId] });
    await this.requireAccess({ auth, permission: Permission.PersonCreate, ids: [dto.id] });
    const face = await this.personRepository.getFaceById(dto.id, { viewingUserId: auth.user.id });
    const person = await this.findOrFail(auth, personGroupId);

    await this.personRepository.reassignFace(face.id, person.personGroupId);
    if (person.faceAssetId === null) {
      await this.createNewFeaturePhoto([person]);
    }
    if (face.person && face.person.faceAssetId === face.id) {
      await this.createNewFeaturePhoto([face.person]);
    }

    return mapPerson(await this.findOrFail(auth, personGroupId));
  }

  // Detaches a face from its person without deleting it or requiring a replacement person --
  // covers "this named person is wrong and I don't know who this actually is", where the
  // alternative today is either keeping the misattribution or inventing a name for a stranger.
  // The face becomes unassigned and is picked back up by the next non-force facial-recognition
  // run for reclustering, same as any newly detected face.
  async unassignFace(auth: AuthDto, id: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.FaceDelete, ids: [id] });
    const face = await this.personRepository.getFaceById(id, { viewingUserId: auth.user.id });
    await this.personRepository.reassignFace(id, null);
    if (face.person && face.person.faceAssetId === face.id) {
      await this.createNewFeaturePhoto([face.person]);
    }
  }

  // Bulk sibling of unassignFace, for "this person is not in this video at all". Video
  // face detection samples frames throughout a video, so a single bad cluster can tag one
  // person across dozens of appearances -- detaching them individually isn't practical.
  // Faces are unassigned rather than deleted, matching unassignFace: if they really are
  // someone else, recognition gets to re-cluster them instead of the detections being lost.
  async unassignPersonFromAsset(
    auth: AuthDto,
    personGroupId: string,
    dto: PersonUnassignFromAssetDto,
  ): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personGroupId] });
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [dto.assetId] });

    const person = await this.findOrFail(auth, personGroupId);
    const unassignedFaceIds = await this.personRepository.unassignPersonFromAsset(personGroupId, dto.assetId);

    // The person's feature photo may have been one of the faces we just detached, which
    // would otherwise leave them showing a thumbnail they're no longer tagged in.
    if (person.faceAssetId && unassignedFaceIds.includes(person.faceAssetId)) {
      await this.createNewFeaturePhoto([person]);
    }
  }

  async getFacesById(auth: AuthDto, dto: FaceDto): Promise<AssetFaceResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [dto.id] });
    const faces = await this.personRepository.getFaces(dto.id, { viewingUserId: auth.user.id, isVisible: true });
    const asset = await this.assetRepository.getForFaces(dto.id);
    const assetDimensions = getDimensions(asset);

    return faces.map((face) => mapFaces(face, auth, asset.edits, assetDimensions));
  }

  async createNewFeaturePhoto(changeFeaturePhoto: PersonId[]) {
    this.logger.debug(
      `Changing feature photos for ${changeFeaturePhoto.length} ${changeFeaturePhoto.length > 1 ? 'people' : 'person'}`,
    );

    const jobs: JobItem[] = [];
    for (const { ownerId, personGroupId } of changeFeaturePhoto) {
      const assetFace = await this.personRepository.getRandomFace(personGroupId);

      if (assetFace) {
        await this.personRepository.update({ ownerId, personGroupId, faceAssetId: assetFace.id });
        jobs.push({ name: JobName.PersonGenerateThumbnail, data: { ownerId, personGroupId } });
      }
    }

    await this.jobRepository.queueAll(jobs);
  }

  async getById(auth: AuthDto, personGroupId: string): Promise<PersonResponseDto> {
    await this.requireAccess({ auth, permission: Permission.PersonRead, ids: [personGroupId] });
    return mapPerson(await this.findOrFail(auth, personGroupId));
  }

  async getStatistics(auth: AuthDto, personGroupId: string): Promise<PersonStatisticsResponseDto> {
    await this.requireAccess({ auth, permission: Permission.PersonRead, ids: [personGroupId] });
    return this.personRepository.getStatistics(personGroupId, auth.user.id);
  }

  async getVideoOccurrences(auth: AuthDto, id: string): Promise<PersonVideoOccurrenceResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.PersonRead, ids: [id] });
    const [rows, { machineLearning }, metadata] = await Promise.all([
      this.personRepository.getVideoOccurrences(id, auth.user.id),
      this.getConfig({ withCache: true }),
      this.userRepository.getMetadata(auth.user.id),
    ]);

    // Grouped on the way out rather than at detection time. Someone on screen for a long stretch
    // produces one detection per sampled frame -- hundreds for a single scene -- which is accurate
    // but unreadable. Collapsing at read time keeps every row in asset_face, so merging two people
    // later still regroups correctly, and changing the setting re-groups without a rescan.
    //
    // How readable a given gap is depends on how reliably faces get detected in that library, so
    // the admin value is only a default -- a user who has set their own overrides it. Null (the
    // preference default) means they haven't, and follows the admin.
    const { people } = getPreferences(metadata);
    const gapSeconds = people.videoAppearanceGapSeconds ?? machineLearning.facialRecognition.video.appearanceGapSeconds;
    const gapMs = gapSeconds * 1000;

    return rows.map((row) => {
      const appearances = groupIntoAppearances(row.timestampsMs, gapMs);
      return {
        assetId: row.assetId,
        originalFileName: row.originalFileName,
        durationMs: row.durationMs,
        timestampsMs: appearances.map(({ startMs }) => startMs),
        appearances,
      };
    });
  }

  async getThumbnail(auth: AuthDto, personGroupId: string): Promise<ImmichFileResponse> {
    await this.requireAccess({ auth, permission: Permission.PersonRead, ids: [personGroupId] });
    const person = await this.personRepository.getByGroupId({ ownerId: auth.user.id, personGroupId });
    if (!person || !person.thumbnailPath) {
      throw new NotFoundException();
    }

    return new ImmichFileResponse({
      path: person.thumbnailPath,
      contentType: mimeTypes.lookup(person.thumbnailPath),
      cacheControl: CacheControl.PrivateWithoutCache,
    });
  }

  async create(auth: AuthDto, dto: PersonCreateDto): Promise<PersonResponseDto> {
    const group = await this.personRepository.createGroup(auth.user.id);
    const person = await this.personRepository.create({
      ownerId: auth.user.id,
      personGroupId: group.id,
      name: dto.name,
      birthDate: dto.birthDate,
      isHidden: dto.isHidden,
      isFavorite: dto.isFavorite,
      color: dto.color,
    });

    return mapPerson(person);
  }

  async update(auth: AuthDto, personGroupId: string, dto: PersonUpdateDto): Promise<PersonResponseDto> {
    await this.requireAccess({ auth, permission: Permission.PersonUpdate, ids: [personGroupId] });

    const { ownerId } = await this.findOrFail(auth, personGroupId);
    const { name, birthDate, isHidden, featureFaceAssetId: assetId, isFavorite, color } = dto;
    // TODO: set by faceId directly
    let faceId: string | undefined;
    if (assetId) {
      await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [assetId] });
      const face = await this.personRepository.getForFeatureFaceUpdate({ personGroupId, assetId });
      if (!face) {
        throw new BadRequestException('Invalid assetId for feature face or asset is offline');
      }

      faceId = face.id;
    }

    const person = await this.personRepository.update({
      ownerId,
      personGroupId,
      faceAssetId: faceId,
      name,
      birthDate,
      isHidden,
      isFavorite,
      color,
    });

    if (assetId) {
      await this.jobRepository.queue({ name: JobName.PersonGenerateThumbnail, data: { ownerId, personGroupId } });
    }

    return mapPerson(person);
  }

  delete(auth: AuthDto, id: string): Promise<void> {
    return this.deleteAll(auth, { ids: [id] });
  }

  async updateAll(auth: AuthDto, dto: PeopleUpdateDto): Promise<BulkIdResponseDto[]> {
    const results: BulkIdResponseDto[] = [];
    for (const person of dto.people) {
      try {
        await this.update(auth, person.id, {
          isHidden: person.isHidden,
          name: person.name,
          birthDate: person.birthDate,
          featureFaceAssetId: person.featureFaceAssetId,
          isFavorite: person.isFavorite,
        });
        results.push({ id: person.id, success: true });
      } catch (error: Error | any) {
        this.logger.error(`Unable to update ${person.id} : ${error}`, error?.stack);
        results.push({ id: person.id, success: false, error: BulkIdErrorReason.UNKNOWN });
      }
    }
    return results;
  }

  async deleteAll(auth: AuthDto, { ids }: BulkIdsDto): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.PersonDelete, ids });
    await this.removeAllPersonGroups(ids, auth.user.id);
  }

  @Chunked()
  private async removeAllPersonGroups(groupIds: string[], ownerId?: string) {
    if (groupIds.length === 0) {
      return;
    }

    const people = await this.personRepository.delete(groupIds, ownerId);
    await Promise.all(people.map((person) => this.storageRepository.unlink(person.thumbnailPath)));
    await this.personRepository.deleteEmptyGroups();
    this.logger.debug(`Deleted ${groupIds.length} people`);
  }

  @OnJob({ name: JobName.PersonCleanup, queue: QueueName.BackgroundTask })
  async handlePersonCleanup(): Promise<JobStatus> {
    // each step can leave the next one something to clean up, so the order matters
    const people = await this.personRepository.getAllWithoutFaces();
    await this.removeAllPersonGroups(people.map((person) => person.personGroupId));

    const personGroups = await this.personRepository.deleteEmptyGroups();
    const clusterGroups = await this.personRepository.deleteOrphanedClusterGroups();

    this.logger.debug(`Deleted ${personGroups} empty person groups and ${clusterGroups} orphaned cluster groups`);

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetDetectFacesQueueAll, queue: QueueName.FaceDetection })
  async handleQueueDetectFaces({ force }: JobOf<JobName.AssetDetectFacesQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isFacialRecognitionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    if (force) {
      await this.personRepository.deleteFaces({ sourceType: SourceType.MachineLearning });
      await this.handlePersonCleanup();
      await this.vacuum('asset_face', 'person', 'face_search');
    }

    for await (const assets of batched(this.assetJobRepository.streamForDetectFacesJob(force))) {
      await this.jobRepository.queueAll(
        assets.map((asset) => ({ name: JobName.AssetDetectFaces, data: { id: asset.id } })),
      );
    }

    if (force === undefined) {
      await this.jobRepository.queue({ name: JobName.PersonCleanup });
    }

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetDetectFaces, queue: QueueName.FaceDetection })
  async handleDetectFaces({ id }: JobOf<JobName.AssetDetectFaces>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isFacialRecognitionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const asset = await this.assetJobRepository.getForDetectFacesJob(id);
    const previewFile = asset?.previewFile;
    if (!asset || !previewFile) {
      return JobStatus.Failed;
    }

    if (asset.visibility === AssetVisibility.Hidden) {
      return JobStatus.Skipped;
    }

    if (asset.type === AssetType.Video && isVideoFaceDetectionDisabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const { imageHeight, imageWidth, faces } = await this.machineLearningRepository.detectFaces(
      previewFile.path,
      machineLearning.facialRecognition,
    );
    this.logger.debug(`${faces.length} faces detected in ${previewFile.path}`);

    // Scoped to this asset's preview-frame faces only: a video asset also carries faces sampled
    // from other frames (asset_face.timestampMs set), which live in a different frame's coordinate
    // space entirely and belong to the separate video-face pipeline. Mixing them in here would
    // both corrupt the scale/IOU match against the freshly re-detected preview faces below, and
    // (via the stale-face sweep) delete every previously detected video face on every re-run of
    // this job, since they'd never IOU-match anything in the preview frame.
    const previewFaces = asset.faces.filter((face) => face.timestampMs == null);

    const facesToAdd: (Insertable<AssetFaceTable> & { id: string })[] = [];
    const embeddings: FaceSearchTable[] = [];
    const mlFaceIds = new Set<string>();

    for (const face of previewFaces) {
      if (face.sourceType === SourceType.MachineLearning) {
        mlFaceIds.add(face.id);
      }
    }

    const heightScale = imageHeight / (previewFaces[0]?.imageHeight || 1);
    const widthScale = imageWidth / (previewFaces[0]?.imageWidth || 1);
    for (const { boundingBox, embedding } of faces) {
      const scaledBox = {
        x1: boundingBox.x1 * widthScale,
        y1: boundingBox.y1 * heightScale,
        x2: boundingBox.x2 * widthScale,
        y2: boundingBox.y2 * heightScale,
      };
      const match = previewFaces.find((face) => this.iou(face, scaledBox) > 0.5);

      if (match && !mlFaceIds.delete(match.id)) {
        embeddings.push({ faceId: match.id, embedding });
      } else if (!match) {
        const faceId = this.cryptoRepository.randomUUID();
        facesToAdd.push({
          id: faceId,
          assetId: asset.id,
          imageHeight,
          imageWidth,
          boundingBoxX1: boundingBox.x1,
          boundingBoxY1: boundingBox.y1,
          boundingBoxX2: boundingBox.x2,
          boundingBoxY2: boundingBox.y2,
        });
        embeddings.push({ faceId, embedding });
      }
    }
    const faceIdsToRemove = [...mlFaceIds];

    if (facesToAdd.length > 0 || faceIdsToRemove.length > 0 || embeddings.length > 0) {
      await this.personRepository.refreshFaces(facesToAdd, faceIdsToRemove, embeddings);
    }

    if (faceIdsToRemove.length > 0) {
      this.logger.log(`Removed ${faceIdsToRemove.length} faces below detection threshold in asset ${id}`);
    }

    if (facesToAdd.length > 0) {
      this.logger.log(`Detected ${facesToAdd.length} new faces in asset ${id}`);
      const jobs = facesToAdd.map((face) => ({ name: JobName.FacialRecognition, data: { id: face.id } }) as const);
      await this.jobRepository.queueAll([{ name: JobName.FacialRecognitionQueueAll, data: { force: false } }, ...jobs]);
    } else if (embeddings.length > 0) {
      this.logger.log(`Added ${embeddings.length} face embeddings for asset ${id}`);
    }

    await this.assetRepository.upsertJobStatus({ assetId: asset.id, facesRecognizedAt: new Date() });

    if (asset.type === AssetType.Video && isVideoFaceScanEnabled(machineLearning)) {
      await this.jobRepository.queue({ name: JobName.AssetVideoDetectFaces, data: { id: asset.id } });
    }

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetVideoDetectFacesQueueAll, queue: QueueName.VideoFaceDetection })
  async handleQueueVideoDetectFaces({ force }: JobOf<JobName.AssetVideoDetectFacesQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isVideoFaceScanEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    let jobs: JobItem[] = [];
    const assets = this.assetJobRepository.streamForVideoDetectFacesJob(force);
    for await (const asset of assets) {
      jobs.push({ name: JobName.AssetVideoDetectFaces, data: { id: asset.id } });

      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }

    await this.jobRepository.queueAll(jobs);

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetVideoDetectFaces, queue: QueueName.VideoFaceDetection })
  async handleVideoDetectFaces({ id }: JobOf<JobName.AssetVideoDetectFaces>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isVideoFaceScanEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const asset = await this.assetJobRepository.getForVideoDetectFacesJob(id);
    if (!asset) {
      return JobStatus.Failed;
    }

    if (asset.visibility === AssetVisibility.Hidden) {
      return JobStatus.Skipped;
    }

    // A re-scan (e.g. after raising the frame rate) should replace this asset's previously
    // detected video faces rather than pile new ones on top of the old set.
    const existingVideoFaces = await this.personRepository.getVideoFacesWithEmbeddings(id);
    const faceIdsToRemove = existingVideoFaces.map((face) => face.id);

    const { samplingMethod, maxFrames, intervalSeconds } = machineLearning.facialRecognition.video;
    const sampling: VideoFrameSampling =
      samplingMethod === VideoFaceSamplingMethod.FrameCount
        ? { method: VideoFaceSamplingMethod.FrameCount }
        : { method: VideoFaceSamplingMethod.Interval, intervalSeconds };

    let tempDir: string | undefined;
    try {
      tempDir = await this.storageRepository.createTempDir('immich-video-faces-');
      const { framePaths, effectiveFrameRate } = await this.mediaRepository.extractVideoFrames(
        asset.originalPath,
        tempDir,
        sampling,
        maxFrames,
      );

      if (framePaths.length === 0) {
        this.logger.debug(`No frames extracted for video ${id}`);
        if (faceIdsToRemove.length > 0) {
          await this.personRepository.refreshFaces([], faceIdsToRemove);
        }
        await this.assetRepository.upsertJobStatus({ assetId: id, videoFacesRecognizedAt: new Date() });
        return JobStatus.Success;
      }

      const facesToAdd: (Insertable<AssetFaceTable> & { id: string })[] = [];
      const embeddings: FaceSearchTable[] = [];

      for (const [frameIndex, framePath] of framePaths.entries()) {
        // Frame 0 is at 0 ms; each subsequent frame is 1/effectiveFrameRate seconds later.
        const timestampMs = Math.round(frameIndex * (1000 / effectiveFrameRate));

        const { imageHeight, imageWidth, faces } = await this.machineLearningRepository.detectFaces(
          framePath,
          machineLearning.facialRecognition,
        );

        for (const { boundingBox, embedding } of faces) {
          const faceId = this.cryptoRepository.randomUUID();
          facesToAdd.push({
            id: faceId,
            assetId: asset.id,
            imageHeight,
            imageWidth,
            boundingBoxX1: boundingBox.x1,
            boundingBoxY1: boundingBox.y1,
            boundingBoxX2: boundingBox.x2,
            boundingBoxY2: boundingBox.y2,
            timestampMs,
          });
          embeddings.push({ faceId, embedding });
        }
      }

      if (facesToAdd.length > 0 || faceIdsToRemove.length > 0) {
        await this.personRepository.refreshFaces(facesToAdd, faceIdsToRemove, embeddings);
        this.logger.log(`Detected ${facesToAdd.length} faces across ${framePaths.length} frames in video ${id}`);
        if (facesToAdd.length > 0) {
          await this.jobRepository.queue({ name: JobName.AssetVideoClusterFaces, data: { id } });
        }
      }
    } finally {
      if (tempDir) {
        await this.storageRepository.unlinkDir(tempDir, { recursive: true, force: true });
      }
    }

    await this.assetRepository.upsertJobStatus({ assetId: id, videoFacesRecognizedAt: new Date() });

    return JobStatus.Success;
  }

  /**
   * Gives each person in a video one person record, keeping every detection.
   *
   * A densely sampled video shows the same person in many nearly identical frames. Recognising those faces one
   * at a time -- or deleting the near-duplicates first, as this job used to -- leaves each surviving face too far
   * from the others to match, so one person turned into dozens of one-face people. Instead the detections are
   * grouped (following a person frame to frame, and back after a cut), and each group is recognised once: it
   * joins the person already on one of its faces, or a matching person elsewhere in the library, or becomes one
   * new person.
   */
  @OnJob({ name: JobName.AssetVideoClusterFaces, queue: QueueName.VideoFaceDetection })
  async handleVideoClusterFaces({ id }: JobOf<JobName.AssetVideoClusterFaces>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isVideoFaceScanEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    // Let queued photo recognition settle first, so a video joins the people it creates instead of racing it.
    await this.jobRepository.waitForQueueCompletion(QueueName.FacialRecognition);

    // The un-timestamped preview-frame face is included, so a person it was already recognised as carries
    // over to the matching video frames.
    const faces = await this.personRepository.getVideoFacesWithEmbeddings(id, { includeUntimedFace: true });
    if (faces.length === 0) {
      return JobStatus.Success;
    }

    const context = await this.personRepository.getFaceForFacialRecognitionJob(faces[0].id);
    if (!context?.asset) {
      this.logger.warn(`Could not find the asset for video ${id}'s faces`);
      return JobStatus.Failed;
    }

    const { ownerId, clusterGroupId, fileCreatedAt, visibility } = context.asset;
    const { maxDistance, minFaces } = machineLearning.facialRecognition;
    const groups = groupVideoFaces(faces, maxDistance);

    let assigned = 0;
    let created = 0;
    for (const group of groups) {
      let personGroupId = mostCommonPersonGroupId(group);

      // Try a few of the clearest faces: one bad angle shouldn't stop a group from finding its person.
      for (const face of personGroupId ? [] : group.slice(0, VIDEO_GROUP_MATCH_ATTEMPTS)) {
        const [match] = await this.searchRepository.searchFaces({
          clusterGroupId,
          embedding: face.embedding,
          maxDistance,
          numResults: 1,
          hasPerson: true,
          minBirthDate: new Date(fileCreatedAt),
        });
        if (match?.personGroupId) {
          personGroupId = match.personGroupId;
          break;
        }
      }

      // Same rule as photo recognition: only this many sightings are enough to be confident it's a new person.
      if (!personGroupId && group.length >= minFaces && visibility === AssetVisibility.Timeline) {
        personGroupId = (await this.personRepository.createGroup(ownerId)).id;
        created++;
      }

      if (!personGroupId) {
        continue;
      }

      const person = await this.personRepository.getByGroupId({ ownerId, personGroupId });
      if (!person) {
        await this.personRepository.create({ ownerId, faceAssetId: group[0].id, personGroupId });
        await this.jobRepository.queue({ name: JobName.PersonGenerateThumbnail, data: { ownerId, personGroupId } });
      }

      // Faces already assigned (the preview face, or a manual correction) are left as they are.
      const faceIds = group.filter((face) => !face.personGroupId).map((face) => face.id);
      if (faceIds.length > 0) {
        await this.personRepository.reassignFaces({ faceIds, newPersonGroupId: personGroupId });
        assigned += faceIds.length;
      }
    }

    this.logger.log(
      `Grouped ${faces.length} faces in video ${id} into ${groups.length} people: assigned ${assigned} faces, created ${created} people`,
    );

    return JobStatus.Success;
  }

  private iou(
    face: { boundingBoxX1: number; boundingBoxY1: number; boundingBoxX2: number; boundingBoxY2: number },
    newBox: BoundingBox,
  ): number {
    const x1 = Math.max(face.boundingBoxX1, newBox.x1);
    const y1 = Math.max(face.boundingBoxY1, newBox.y1);
    const x2 = Math.min(face.boundingBoxX2, newBox.x2);
    const y2 = Math.min(face.boundingBoxY2, newBox.y2);

    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const area1 = (face.boundingBoxX2 - face.boundingBoxX1) * (face.boundingBoxY2 - face.boundingBoxY1);
    const area2 = (newBox.x2 - newBox.x1) * (newBox.y2 - newBox.y1);
    const union = area1 + area2 - intersection;

    return intersection / union;
  }

  @OnJob({ name: JobName.FacialRecognitionQueueAll, queue: QueueName.FacialRecognition })
  async handleQueueRecognizeFaces({
    force,
    nightly,
    clusterGroupId,
  }: JobOf<JobName.FacialRecognitionQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isFacialRecognitionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    await this.jobRepository.waitForQueueCompletion(QueueName.ThumbnailGeneration, QueueName.FaceDetection);

    if (nightly) {
      const [state, latestFaceDate] = await Promise.all([
        this.systemMetadataRepository.get(SystemMetadataKey.FacialRecognitionState),
        this.personRepository.getLatestFaceDate(),
      ]);

      if (state?.lastRun && latestFaceDate && state.lastRun > latestFaceDate) {
        this.logger.debug('Skipping facial recognition nightly since no face has been added since the last run');
        return JobStatus.Skipped;
      }
    }

    const { waiting } = await this.jobRepository.getJobCounts(QueueName.FacialRecognition);

    if (force) {
      await this.personRepository.unassignFaces({ clusterGroupId, sourceType: SourceType.MachineLearning });
      await this.handlePersonCleanup();
      await this.vacuum('asset_face', 'person');
    } else if (waiting) {
      this.logger.debug(
        `Skipping facial recognition queueing because ${waiting} job${waiting > 1 ? 's are' : ' is'} already queued`,
      );
      return JobStatus.Skipped;
    }

    await this.databaseRepository.prewarm(VectorIndex.Face);

    const lastRun = new Date().toISOString();

    const faces = this.personRepository.getAllFaces(
      force
        ? { clusterGroupId, sourceType: clusterGroupId ? SourceType.MachineLearning : undefined }
        : { personGroupId: null, clusterGroupId, sourceType: SourceType.MachineLearning },
    );
    for await (const batch of batched(faces)) {
      await this.jobRepository.queueAll(
        batch.map((face) => ({ name: JobName.FacialRecognition, data: { id: face.id, deferred: false } })),
      );
    }

    if (force && isVideoFaceScanEnabled(machineLearning)) {
      // A reset unassigns video faces too, and recognition leaves those to video face grouping: re-group every
      // video. Each job waits for the recognition queued above to finish first.
      let jobs: JobItem[] = [];
      for await (const asset of this.assetJobRepository.streamForVideoDetectFacesJob(true)) {
        jobs.push({ name: JobName.AssetVideoClusterFaces, data: { id: asset.id } });
        if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
          await this.jobRepository.queueAll(jobs);
          jobs = [];
        }
      }
      await this.jobRepository.queueAll(jobs);
    }

    await this.systemMetadataRepository.set(SystemMetadataKey.FacialRecognitionState, { lastRun });

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.FacialRecognition, queue: QueueName.FacialRecognition })
  async handleRecognizeFaces({ id, deferred }: JobOf<JobName.FacialRecognition>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isFacialRecognitionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const face = await this.personRepository.getFaceForFacialRecognitionJob(id);
    if (!face || !face.asset) {
      this.logger.warn(`Face ${id} not found`);
      return JobStatus.Failed;
    }

    if (face.sourceType !== SourceType.MachineLearning) {
      this.logger.warn(`Skipping face ${id} due to source ${face.sourceType}`);
      return JobStatus.Skipped;
    }

    if (!face.faceSearch?.embedding) {
      this.logger.warn(`Face ${id} does not have an embedding`);
      return JobStatus.Failed;
    }

    if (face.personGroupId) {
      this.logger.debug(`Face ${id} already has a person assigned`);
      return JobStatus.Skipped;
    }

    // Faces from sampled video frames are recognised a whole group at a time by handleVideoClusterFaces. One by
    // one they're near-duplicates of each other, which is what split one person into many.
    if (face.timestampMs !== null) {
      this.logger.debug(`Face ${id} is from a video frame, leaving it to video face grouping`);
      return JobStatus.Skipped;
    }

    const { ownerId, clusterGroupId } = face.asset;
    const matches = await this.searchRepository.searchFaces({
      clusterGroupId,
      embedding: face.faceSearch.embedding,
      maxDistance: machineLearning.facialRecognition.maxDistance,
      numResults: machineLearning.facialRecognition.minFaces,
      minBirthDate: new Date(face.asset.fileCreatedAt),
    });

    // `matches` also includes the face itself
    if (machineLearning.facialRecognition.minFaces > 1 && matches.length <= 1) {
      this.logger.debug(`Face ${id} only matched the face itself, skipping`);
      return JobStatus.Skipped;
    }

    this.logger.debug(`Face ${id} has ${matches.length} matches`);

    const isCore =
      matches.length >= machineLearning.facialRecognition.minFaces &&
      face.asset.visibility === AssetVisibility.Timeline;
    if (!isCore && !deferred) {
      this.logger.debug(`Deferring non-core face ${id} for later processing`);
      await this.jobRepository.queue({ name: JobName.FacialRecognition, data: { id, deferred: true } });
      return JobStatus.Skipped;
    }

    let personGroupId = matches.find((match) => match.personGroupId)?.personGroupId;
    if (!personGroupId) {
      const [matchWithPerson] = await this.searchRepository.searchFaces({
        clusterGroupId,
        embedding: face.faceSearch.embedding,
        maxDistance: machineLearning.facialRecognition.maxDistance,
        numResults: 1,
        hasPerson: true,
        minBirthDate: new Date(face.asset.fileCreatedAt),
      });

      personGroupId = matchWithPerson?.personGroupId ?? undefined;
    }

    if (!personGroupId && isCore) {
      const group = await this.personRepository.createGroup(ownerId);
      personGroupId = group.id;
      this.logger.log(`Created person group ${personGroupId} for face ${id}`);
    }

    if (personGroupId) {
      const person = await this.personRepository.getByGroupId({ ownerId, personGroupId });
      if (person) {
        this.logger.debug(`Face ${id} matched person ${person.personGroupId}`);
      } else {
        await this.personRepository.create({ ownerId, faceAssetId: face.id, personGroupId });
        this.logger.log(`Created person for face ${id} in group ${personGroupId}`);
        await this.jobRepository.queue({
          name: JobName.PersonGenerateThumbnail,
          data: { ownerId, personGroupId },
        });
      }

      this.logger.debug(`Assigning face ${id} to person group ${personGroupId}`);
      await this.personRepository.reassignFaces({ faceIds: [id], newPersonGroupId: personGroupId });
    }

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.PersonFileMigration, queue: QueueName.Migration })
  async handlePersonMigration({ ownerId, personGroupId }: JobOf<JobName.PersonFileMigration>): Promise<JobStatus> {
    const person = await this.personRepository.getByGroupId({ ownerId, personGroupId });
    if (!person) {
      return JobStatus.Failed;
    }

    await this.storageCore.movePersonFile(person, PersonPathType.Face);

    return JobStatus.Success;
  }

  async mergePeople(auth: AuthDto, { ids }: MergePersonDto): Promise<BulkIdResponseDto[]> {
    if (ids.length < 2) {
      throw new BadRequestException('At least two people are required for merging');
    }

    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Cannot merge a person into themselves');
    }

    const results: BulkIdResponseDto[] = [];

    const allowedIds = await this.checkAccess({ auth, permission: Permission.PersonMerge, ids });

    const peopleMap: Record<string, Selectable<PersonTable>[]> = {};

    for (const mergePerson of await this.personRepository.getForMergePerson(ids)) {
      if (!peopleMap[mergePerson.personGroupId]) {
        peopleMap[mergePerson.personGroupId] = [];
      }
      peopleMap[mergePerson.personGroupId].push(mergePerson);
    }

    const targetPeople: Record<string, Selectable<PersonTable>> = {};
    for (const mergeId of ids) {
      const hasAccess = allowedIds.has(mergeId);
      if (!hasAccess) {
        results.push({ id: mergeId, success: false, error: BulkIdErrorReason.NO_PERMISSION });
        continue;
      }

      for (const mergePerson of peopleMap[mergeId]) {
        if (!targetPeople[mergePerson.ownerId]) {
          targetPeople[mergePerson.ownerId] = mergePerson;
          continue;
        }

        const targetPerson = targetPeople[mergePerson.ownerId];

        if (
          mergePerson.ownerId !== auth.user.id &&
          ((targetPerson.name && mergePerson.name) || (targetPerson.birthDate && mergePerson.birthDate))
        ) {
          continue;
        }

        const changes: Updateable<Person> = _.omitBy(
          {
            name: mergePerson.name && !targetPerson.name ? mergePerson.name : undefined,
            birthDate: mergePerson.birthDate && !targetPerson.birthDate ? mergePerson.birthDate : undefined,
          },
          _.isUndefined,
        );

        if (Object.keys(changes).length > 0) {
          targetPeople[mergePerson.ownerId] = await this.personRepository.update({
            ownerId: targetPerson.ownerId,
            personGroupId: targetPerson.personGroupId,
            ...changes,
          });
        }

        const mergeName = mergePerson.name || mergePerson.personGroupId;
        const mergeData: UpdateFacesData = {
          oldPersonGroupId: mergeId,
          newPersonGroupId: targetPerson.personGroupId,
          ownerId: targetPerson.ownerId,
        };
        this.logger.log(`Merging ${mergeName} into ${targetPerson.name || targetPerson.personGroupId}`);

        try {
          await this.personRepository.reassignFaces(mergeData);
          await this.removeAllPersonGroups([mergeId], targetPerson.ownerId);

          this.logger.log(`Merged ${mergeName} into ${targetPerson.name || targetPerson.personGroupId}`);
          results.push({ id: mergeId, success: true });
        } catch (error: any) {
          this.logger.error(`Unable to merge ${mergeId} into ${targetPerson.personGroupId}: ${error}`, error?.stack);
          results.push({ id: mergeId, success: false, error: BulkIdErrorReason.UNKNOWN });
        }
      }
    }

    return results;
  }

  private findOrFail(auth: AuthDto, personGroupId: string) {
    return findOrFail(() => this.personRepository.getByGroupId({ ownerId: auth.user.id, personGroupId }), 'Person');
  }

  // TODO return a asset face response
  async createFace(auth: AuthDto, dto: AssetFaceCreateDto): Promise<void> {
    await Promise.all([
      this.requireAccess({ auth, permission: Permission.AssetUpdate, ids: [dto.assetId] }),
      this.requireAccess({ auth, permission: Permission.PersonRead, ids: [dto.personId] }),
    ]);

    const [asset, person] = await Promise.all([
      this.assetRepository.getById(dto.assetId, { edits: true, exifInfo: true }),
      this.findOrFail(auth, dto.personId),
    ]);

    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    const edits = asset.edits || [];

    let topLeft: Point = { x: dto.x, y: dto.y };
    let bottomRight: Point = { x: dto.x + dto.width, y: dto.y + dto.height };

    // the coordinates received from the client are based on the edited preview image
    // we need to convert them to the coordinate space of the original unedited image
    if (edits.length > 0) {
      if (!asset.width || !asset.height || !asset.exifInfo?.exifImageWidth || !asset.exifInfo?.exifImageHeight) {
        throw new BadRequestException('Asset does not have valid dimensions');
      }

      // convert from preview to full dimensions
      const scaleFactor = asset.width / dto.imageWidth;
      topLeft = { x: topLeft.x * scaleFactor, y: topLeft.y * scaleFactor };
      bottomRight = { x: bottomRight.x * scaleFactor, y: bottomRight.y * scaleFactor };

      const [invertedTopLeft, invertedBottomRight] = transformPoints(
        [topLeft, bottomRight],
        edits,
        { width: asset.width, height: asset.height },
        { inverse: true },
      ).points;

      // make sure topLeft is top-left and bottomRight is bottom-right
      topLeft = {
        x: Math.min(invertedTopLeft.x, invertedBottomRight.x),
        y: Math.min(invertedTopLeft.y, invertedBottomRight.y),
      };
      bottomRight = {
        x: Math.max(invertedTopLeft.x, invertedBottomRight.x),
        y: Math.max(invertedTopLeft.y, invertedBottomRight.y),
      };

      // now coordinates are in original image space
      const originalDimensions = getDimensions(asset.exifInfo);
      dto.imageWidth = originalDimensions.width;
      dto.imageHeight = originalDimensions.height;
    }

    await this.personRepository.createAssetFace({
      personGroupId: person.personGroupId,
      assetId: dto.assetId,
      imageHeight: dto.imageHeight,
      imageWidth: dto.imageWidth,
      boundingBoxX1: Math.round(topLeft.x),
      boundingBoxX2: Math.round(bottomRight.x),
      boundingBoxY1: Math.round(topLeft.y),
      boundingBoxY2: Math.round(bottomRight.y),
      sourceType: SourceType.Manual,
      // Without this, a face manually tagged on a paused video frame is indistinguishable from a
      // preview-frame (photo-style) face -- its bounding box would get cropped out of the wrong
      // frame for thumbnail generation, and it would never appear in the video-appearances list.
      timestampMs: dto.timestampMs ?? null,
    });

    if (!person.faceAssetId) {
      await this.createNewFeaturePhoto([person]);
    }
  }

  async deleteFace(auth: AuthDto, id: string, dto: AssetFaceDeleteDto): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.FaceDelete, ids: [id] });

    return dto.force ? this.personRepository.deleteAssetFace(id) : this.personRepository.softDeleteAssetFaces(id);
  }

  private vacuum(...tables: (keyof DB)[]): Promise<unknown> {
    return Promise.all(
      tables.map((table) =>
        this.databaseRepository
          .vacuum({ analyze: true, table })
          .then(() => this.databaseRepository.reindex(table, { concurrently: true })),
      ),
    );
  }
}
