-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('OPEN', 'ACCEPTED', 'ARRIVING', 'IN_PROGRESS', 'COMPLETED', 'CANCELED');

-- CreateTable
CREATE TABLE "Driver" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "phone" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RideRequest" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "driverId" INTEGER,
    "pickupText" TEXT NOT NULL,
    "dropoffText" TEXT,
    "status" "RideStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RideRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Driver_phone_key" ON "Driver"("phone");

-- CreateIndex
CREATE INDEX "RideRequest_status_idx" ON "RideRequest"("status");

-- CreateIndex
CREATE INDEX "RideRequest_customerId_idx" ON "RideRequest"("customerId");

-- CreateIndex
CREATE INDEX "RideRequest_driverId_idx" ON "RideRequest"("driverId");

-- AddForeignKey
ALTER TABLE "RideRequest" ADD CONSTRAINT "RideRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideRequest" ADD CONSTRAINT "RideRequest_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
