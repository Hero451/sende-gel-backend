-- CreateEnum
CREATE TYPE "DriverAvailability" AS ENUM ('OFFLINE', 'ONLINE', 'BUSY');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RideStatus" ADD VALUE 'SEARCHING';
ALTER TYPE "RideStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "availability" "DriverAvailability" NOT NULL DEFAULT 'OFFLINE',
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "RideRequest" ADD COLUMN     "dropoffLat" DOUBLE PRECISION,
ADD COLUMN     "dropoffLng" DOUBLE PRECISION,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "phase" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "pickupLat" DOUBLE PRECISION,
ADD COLUMN     "pickupLng" DOUBLE PRECISION,
ADD COLUMN     "searchRadiusKm" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "RideOffer" (
    "id" SERIAL NOT NULL,
    "rideRequestId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),

    CONSTRAINT "RideOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RideOffer_driverId_idx" ON "RideOffer"("driverId");

-- CreateIndex
CREATE INDEX "RideOffer_rideRequestId_idx" ON "RideOffer"("rideRequestId");

-- CreateIndex
CREATE INDEX "RideOffer_status_idx" ON "RideOffer"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RideOffer_rideRequestId_driverId_key" ON "RideOffer"("rideRequestId", "driverId");

-- AddForeignKey
ALTER TABLE "RideOffer" ADD CONSTRAINT "RideOffer_rideRequestId_fkey" FOREIGN KEY ("rideRequestId") REFERENCES "RideRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideOffer" ADD CONSTRAINT "RideOffer_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
