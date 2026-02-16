/*
  Warnings:

  - The `status` column on the `Assignment` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `RideRequest` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('NEW', 'ASSIGNED', 'ACCEPTED', 'ARRIVED', 'STARTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('SENT', 'ACCEPTED', 'ARRIVED', 'STARTED', 'COMPLETED');

-- AlterTable
ALTER TABLE "Assignment" DROP COLUMN "status",
ADD COLUMN     "status" "AssignmentStatus" NOT NULL DEFAULT 'SENT';

-- AlterTable
ALTER TABLE "RideRequest" DROP COLUMN "status",
ADD COLUMN     "status" "RideStatus" NOT NULL DEFAULT 'NEW';
