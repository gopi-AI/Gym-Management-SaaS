import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P2-05 — optional exercise-library media.
 *
 * Adds the image/GIF object keys and the optional YouTube URL. Only a key
 * returned by `S3Service` is stored (never a client path), and the video URL is
 * constrained at the DTO boundary to the canonical YouTube shapes.
 *
 * Existing exercises keep NULL media; nothing is fabricated.
 */
export class AddExerciseMedia1793000000000 implements MigrationInterface {
  name = 'AddExerciseMedia1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_EXERCISES"
        ADD COLUMN "image_key" varchar(1024),
        ADD COLUMN "image_mime_type" varchar(100),
        ADD COLUMN "gif_key" varchar(1024),
        ADD COLUMN "gif_mime_type" varchar(100),
        ADD COLUMN "video_url" varchar(2048);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "WORKOUTS_EXERCISES"
        DROP COLUMN "video_url",
        DROP COLUMN "gif_mime_type",
        DROP COLUMN "gif_key",
        DROP COLUMN "image_mime_type",
        DROP COLUMN "image_key";
    `);
  }
}
