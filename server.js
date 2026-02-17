import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const app = express();
const prisma = new PrismaClient();

const PORT = Number(process.env.PORT) || 4000;

// ✅ Güvenlik: JWT_SECRET yoksa uyar (Render'da eklemen şart)
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn(
    "⚠️ JWT_SECRET bulunamadı! Render > Environment'a JWT_SECRET eklemen gerekiyor."
  );
}

// Render/Prod ortamında CORS listesi
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:4000",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:4000",
  "https://sendegelvip.com",
  "https://www.sendegelvip.com",
];

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  cors({
    origin: function (origin, cb) {
      // Mobil uygulamada bazen origin boş gelir (native). Buna izin veriyoruz.
      if (!origin) return cb(null, true);

      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("CORS blocked: " + origin), false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

/* =========================
   BASIC
========================= */
app.get("/", (req, res) => {
  res.send("Sende Gel Backend Production API 🚕");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Server ayakta", port: PORT });
});

/* =========================
   HELPERS
========================= */
function mustHaveJwtSecret(res) {
  if (!JWT_SECRET) {
    res.status(500).json({
      ok: false,
      message:
        "JWT_SECRET eksik. Render > Environment'a JWT_SECRET ekle ve yeniden deploy et.",
    });
    return false;
  }
  return true;
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function auth(req, res, next) {
  if (!mustHaveJwtSecret(res)) return;

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, message: "Token yok." });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.userId) {
      return res.status(401).json({ ok: false, message: "Customer token değil." });
    }
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ ok: false, message: "Token geçersiz." });
  }
}

function driverAuth(req, res, next) {
  if (!mustHaveJwtSecret(res)) return;

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, message: "Token yok." });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.driverId) {
      return res.status(401).json({ ok: false, message: "Driver token değil." });
    }
    req.driverId = payload.driverId;
    next();
  } catch {
    return res.status(401).json({ ok: false, message: "Token geçersiz." });
  }
}

const ALLOWED_RIDE_STATUS = new Set([
  "OPEN",
  "SEARCHING",
  "ACCEPTED",
  "ARRIVING",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELED",
  "FAILED",
]);

/* =========================
   CUSTOMER AUTH
========================= */
app.post("/auth/register", async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;

    if (!password || (!phone && !email)) {
      return res
        .status(400)
        .json({ ok: false, message: "Telefon veya email ve şifre gerekli." });
    }

    const existing = await prisma.user.findFirst({
      where: {
        OR: [phone ? { phone } : undefined, email ? { email } : undefined].filter(Boolean),
      },
    });

    if (existing) {
      return res.status(409).json({ ok: false, message: "Kullanıcı zaten var." });
    }

    const hashed = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name: name || null,
        phone: phone || null,
        email: email || null,
        password: hashed,
      },
      select: { id: true, name: true, phone: true, email: true, createdAt: true },
    });

    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ ok: false, message: "Register hata", error: String(err) });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    if (!mustHaveJwtSecret(res)) return;

    const { phone, email, password } = req.body;

    if (!password || (!phone && !email)) {
      return res
        .status(400)
        .json({ ok: false, message: "Telefon veya email ve şifre gerekli." });
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [phone ? { phone } : undefined, email ? { email } : undefined].filter(Boolean),
      },
    });

    if (!user) return res.status(401).json({ ok: false, message: "Kullanıcı bulunamadı." });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ ok: false, message: "Şifre yanlış." });

    const token = signToken({ userId: user.id, role: "customer" });

    res.json({
      ok: true,
      token,
      user: { id: user.id, name: user.name, phone: user.phone, email: user.email },
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: "Login hata", error: String(err) });
  }
});

app.get("/me", auth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, name: true, phone: true, email: true, createdAt: true },
    });
    res.json({ ok: true, user });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Me hata", error: String(e) });
  }
});

/* =========================
   DRIVER AUTH
========================= */
app.post("/drivers/register", async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ ok: false, message: "Telefon ve şifre gerekli." });
    }

    const exists = await prisma.driver.findUnique({ where: { phone } });
    if (exists) return res.status(409).json({ ok: false, message: "Sürücü zaten var." });

    const hashed = await bcrypt.hash(password, 10);

    const driver = await prisma.driver.create({
      data: { name: name || null, phone, password: hashed, isOnline: false },
      select: { id: true, name: true, phone: true, isOnline: true, createdAt: true },
    });

    res.json({ ok: true, driver });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Driver register hata", error: String(e) });
  }
});

app.post("/drivers/login", async (req, res) => {
  try {
    if (!mustHaveJwtSecret(res)) return;

    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ ok: false, message: "Telefon ve şifre gerekli." });
    }

    const driver = await prisma.driver.findUnique({ where: { phone } });
    if (!driver) return res.status(401).json({ ok: false, message: "Sürücü bulunamadı." });

    const ok = await bcrypt.compare(password, driver.password);
    if (!ok) return res.status(401).json({ ok: false, message: "Şifre yanlış." });

    const token = signToken({ driverId: driver.id, role: "driver" });

    res.json({
      ok: true,
      token,
      driver: { id: driver.id, name: driver.name, phone: driver.phone, isOnline: driver.isOnline },
    });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Driver login hata", error: String(e) });
  }
});

app.get("/drivers/me", driverAuth, async (req, res) => {
  try {
    const driver = await prisma.driver.findUnique({
      where: { id: req.driverId },
      select: { id: true, name: true, phone: true, isOnline: true, createdAt: true },
    });
    res.json({ ok: true, driver });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Driver me hata", error: String(e) });
  }
});

app.post("/drivers/online", driverAuth, async (req, res) => {
  try {
    const { isOnline } = req.body;
    const driver = await prisma.driver.update({
      where: { id: req.driverId },
      data: { isOnline: Boolean(isOnline) },
      select: { id: true, isOnline: true },
    });
    res.json({ ok: true, driver });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Online update hata", error: String(e) });
  }
});

/* =========================
   DRIVER LIVE STATUS / LOCATION
========================= */

// Sürücü: ONLINE/BUSY/OFFLINE (Panel düğmesi buraya bağlanacak)
app.post("/drivers/availability", driverAuth, async (req, res) => {
  try {
    // Eski isOnline desteği de kalsın diye:
    const { availability, isOnline } = req.body;

    // availability gelirse onu kullan
    let nextAvailability = null;
    if (availability) {
      const v = String(availability).toUpperCase();
      if (!["ONLINE", "BUSY", "OFFLINE"].includes(v)) {
        return res.status(400).json({ ok: false, message: "availability ONLINE/BUSY/OFFLINE olmalı." });
      }
      nextAvailability = v;
    }

    // availability yoksa isOnline'dan çevir (geriye dönük)
    if (!nextAvailability && typeof isOnline !== "undefined") {
      nextAvailability = Boolean(isOnline) ? "ONLINE" : "OFFLINE";
    }

    if (!nextAvailability) {
      return res.status(400).json({ ok: false, message: "availability veya isOnline gönder." });
    }

    const driver = await prisma.driver.update({
      where: { id: req.driverId },
      data: {
        availability: nextAvailability,
        // isOnline kolonunu da uyumlu tutalım
        isOnline: nextAvailability === "ONLINE",
      },
      select: { id: true, isOnline: true, availability: true },
    });

    res.json({ ok: true, driver });
  } catch (e) {
    res.status(500).json({ ok: false, message: "availability update hata", error: String(e) });
  }
});

// Sürücü konumu güncelle (5km/10km hesabı için şart)
app.post("/drivers/location", driverAuth, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const fLat = Number(lat);
    const fLng = Number(lng);
    if (!Number.isFinite(fLat) || !Number.isFinite(fLng)) {
      return res.status(400).json({ ok: false, message: "lat ve lng sayı olmalı." });
    }

    const driver = await prisma.driver.update({
      where: { id: req.driverId },
      data: { lat: fLat, lng: fLng },
      select: { id: true, lat: true, lng: true, availability: true, isOnline: true },
    });

    res.json({ ok: true, driver });
  } catch (e) {
    res.status(500).json({ ok: false, message: "location update hata", error: String(e) });
  }
});

/* =========================
   MATCHING / SEARCH ENGINE
========================= */

function toRad(x) {
  return (x * Math.PI) / 180;
}

// KM cinsinden mesafe (Haversine)
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function expireOldOffers(rideRequestId) {
  const now = new Date();
  await prisma.rideOffer.updateMany({
    where: {
      rideRequestId,
      status: "SENT",
      expiresAt: { lte: now },
    },
    data: { status: "EXPIRED" },
  });
}

async function createOffersForRide({ ride, radiusKm, ttlSeconds }) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  // Online & müsait sürücüler: availability ONLINE veya isOnline true (geri uyum)
  const candidates = await prisma.driver.findMany({
    where: {
      OR: [
        { availability: "ONLINE" },
        { isOnline: true },
      ],
    },
    select: { id: true, lat: true, lng: true, availability: true, isOnline: true },
  });

  let chosen = candidates;

  // Konum varsa yarıçap filtresi uygula
  if (ride.pickupLat != null && ride.pickupLng != null) {
    chosen = candidates.filter((d) => {
      if (d.lat == null || d.lng == null) return false;
      const km = distanceKm(ride.pickupLat, ride.pickupLng, d.lat, d.lng);
      return km <= radiusKm;
    });
  }

  if (chosen.length === 0) return { count: 0, expiresAt };

  // Offer createMany (aynı sürücüye iki kere gitmesin diye skipDuplicates)
  const data = chosen.map((d) => ({
    rideRequestId: ride.id,
    driverId: d.id,
    status: "SENT",
    expiresAt,
  }));

  const created = await prisma.rideOffer.createMany({
    data,
    skipDuplicates: true,
  });

  // RideRequest üzerinde arama bilgisi güncelle
  await prisma.rideRequest.update({
    where: { id: ride.id },
    data: {
      status: "SEARCHING",
      searchRadiusKm: radiusKm,
      expiresAt,
    },
  });

  return { count: created.count, expiresAt };
}

// Faz motoru: 1) 5km 15sn, 2) 5km 7sn, 3) 10km 12sn, yoksa FAILED
async function runRideSearch(rideRequestId) {
  // Faz-1
  await runPhase(rideRequestId, 1);
}

async function runPhase(rideRequestId, phase) {
  // önce expire
  await expireOldOffers(rideRequestId);

  const ride = await prisma.rideRequest.findUnique({
    where: { id: rideRequestId },
    select: { id: true, status: true, driverId: true, pickupLat: true, pickupLng: true, phase: true },
  });

  if (!ride) return;

  // zaten bitti mi?
  if (ride.driverId || ["ACCEPTED", "ARRIVING", "IN_PROGRESS", "COMPLETED", "CANCELED", "FAILED"].includes(ride.status)) {
    return;
  }

  let radiusKm = 5;
  let ttlSeconds = 15;

  if (phase === 1) { radiusKm = 5; ttlSeconds = 15; }
  if (phase === 2) { radiusKm = 5; ttlSeconds = 7; }
  if (phase === 3) { radiusKm = 10; ttlSeconds = 12; }

  // Ride üzerinde phase yaz
  await prisma.rideRequest.update({
    where: { id: rideRequestId },
    data: { phase },
  });

  // Offers oluştur
  const { count, expiresAt } = await createOffersForRide({
    ride: { ...ride, pickupLat: ride.pickupLat, pickupLng: ride.pickupLng, id: ride.id },
    radiusKm,
    ttlSeconds,
  });

  // Hiç sürücü yoksa direkt bir sonraki faza geç / veya fail
  if (count === 0) {
    if (phase < 3) return runPhase(rideRequestId, phase + 1);

    await prisma.rideRequest.update({
      where: { id: rideRequestId },
      data: { status: "FAILED", expiresAt: null },
    });
    return;
  }

  // Süre bitince kontrol et
  setTimeout(async () => {
    try {
      await expireOldOffers(rideRequestId);

      const latest = await prisma.rideRequest.findUnique({
        where: { id: rideRequestId },
        select: { id: true, status: true, driverId: true },
      });

      if (!latest) return;
      if (latest.driverId || ["ACCEPTED", "ARRIVING", "IN_PROGRESS", "COMPLETED", "CANCELED"].includes(latest.status)) return;

      if (phase < 3) {
        await runPhase(rideRequestId, phase + 1);
      } else {
        await prisma.rideRequest.update({
          where: { id: rideRequestId },
          data: { status: "FAILED", expiresAt: null },
        });
      }
    } catch (err) {
      console.error("phase timeout error:", err);
    }
  }, ttlSeconds * 1000);
}

/* =========================
   RIDES (CUSTOMER)
========================= */

app.post("/rides/create", auth, async (req, res) => {
  try {
    const { pickupText, pickupLat, pickupLng, dropoffText, dropoffLat, dropoffLng } = req.body;

    if (!pickupText) {
      return res.status(400).json({ ok: false, message: "pickupText gerekli." });
    }

    // Lat/Lng opsiyonel ama varsa sayı olmalı
    const pLat = pickupLat == null ? null : Number(pickupLat);
    const pLng = pickupLng == null ? null : Number(pickupLng);
    if ((pLat != null && !Number.isFinite(pLat)) || (pLng != null && !Number.isFinite(pLng))) {
      return res.status(400).json({ ok: false, message: "pickupLat/pickupLng sayı olmalı." });
    }

    const dLat = dropoffLat == null ? null : Number(dropoffLat);
    const dLng = dropoffLng == null ? null : Number(dropoffLng);
    if ((dLat != null && !Number.isFinite(dLat)) || (dLng != null && !Number.isFinite(dLng))) {
      return res.status(400).json({ ok: false, message: "dropoffLat/dropoffLng sayı olmalı." });
    }

    const ride = await prisma.rideRequest.create({
      data: {
        customerId: req.userId,
        pickupText,
        pickupLat: pLat,
        pickupLng: pLng,
        dropoffText: dropoffText || null,
        dropoffLat: dLat,
        dropoffLng: dLng,
        status: "SEARCHING",
        phase: 1,
        searchRadiusKm: 5,
      },
      select: {
        id: true,
        status: true,
        phase: true,
        searchRadiusKm: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    // Aramayı başlat (asenkron)
    runRideSearch(ride.id).catch((err) => console.error("runRideSearch error:", err));

    res.json({
      ok: true,
      message: "Taksi çağrısı başlatıldı.",
      ride,
    });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Ride create hata", error: String(e) });
  }
});

// Müşteri: ride durumunu takip
app.get("/rides/status/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Geçersiz ride id" });
    }

    const ride = await prisma.rideRequest.findUnique({
      where: { id },
      include: {
        driver: { select: { id: true, name: true, phone: true, availability: true, isOnline: true } },
      },
    });

    if (!ride) return res.status(404).json({ ok: false, message: "Ride bulunamadı" });
    if (ride.customerId !== req.userId) return res.status(403).json({ ok: false, message: "Bu ride sana ait değil" });

    res.json({ ok: true, ride });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Ride status hata", error: String(e) });
  }
});

app.get("/rides/my", auth, async (req, res) => {
  try {
    const rides = await prisma.rideRequest.findMany({
      where: { customerId: req.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ ok: true, rides });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Rides my hata", error: String(e) });
  }
});

/* =========================
   OFFERS (DRIVER)
========================= */

// Sürücüye gelen aktif çağrılar
app.get("/drivers/offers", driverAuth, async (req, res) => {
  try {
    const now = new Date();

    await prisma.rideOffer.updateMany({
      where: { driverId: req.driverId, status: "SENT", expiresAt: { lte: now } },
      data: { status: "EXPIRED" },
    });

    const offers = await prisma.rideOffer.findMany({
      where: {
        driverId: req.driverId,
        status: "SENT",
        expiresAt: { gt: now },
      },
      orderBy: { sentAt: "desc" },
      include: {
        rideRequest: {
          select: {
            id: true,
            pickupText: true,
            dropoffText: true,
            status: true,
            phase: true,
            searchRadiusKm: true,
            expiresAt: true,
            createdAt: true,
          },
        },
      },
      take: 20,
    });

    res.json({ ok: true, offers });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Offers hata", error: String(e) });
  }
});

// Sürücü çağrıyı kabul et
app.post("/drivers/offers/:offerId/accept", driverAuth, async (req, res) => {
  try {
    const offerId = Number(req.params.offerId);
    if (!Number.isFinite(offerId)) {
      return res.status(400).json({ ok: false, message: "offerId geçersiz" });
    }

    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const offer = await tx.rideOffer.findFirst({
        where: { id: offerId, driverId: req.driverId },
        include: { rideRequest: true },
      });

      if (!offer) return { ok: false, code: 404, message: "Offer bulunamadı" };

      if (offer.status !== "SENT") return { ok: false, code: 409, message: "Offer artık geçerli değil." };
      if (offer.expiresAt <= now) {
        await tx.rideOffer.update({ where: { id: offerId }, data: { status: "EXPIRED" } });
        return { ok: false, code: 409, message: "Offer süresi dolmuş." };
      }

      const ride = await tx.rideRequest.findUnique({ where: { id: offer.rideRequestId } });
      if (!ride) return { ok: false, code: 404, message: "Ride yok" };

      if (ride.driverId) return { ok: false, code: 409, message: "Çağrı zaten alınmış." };
      if (["FAILED", "CANCELED", "COMPLETED"].includes(ride.status)) {
        return { ok: false, code: 409, message: "Çağrı artık geçerli değil." };
      }

      // Ride'ı ata
      await tx.rideRequest.update({
        where: { id: ride.id },
        data: { driverId: req.driverId, status: "ACCEPTED", expiresAt: null },
      });

      // Bu offer ACCEPTED
      await tx.rideOffer.update({
        where: { id: offerId },
        data: { status: "ACCEPTED", acceptedAt: now },
      });

      // Diğer SENT offer'ları EXPIRED yap
      await tx.rideOffer.updateMany({
        where: { rideRequestId: ride.id, status: "SENT" },
        data: { status: "EXPIRED" },
      });

      // Sürücüyü BUSY yap (meşgul)
      await tx.driver.update({
        where: { id: req.driverId },
        data: { availability: "BUSY", isOnline: true },
      });

      const updatedRide = await tx.rideRequest.findUnique({
        where: { id: ride.id },
        include: { customer: { select: { id: true, name: true, phone: true } } },
      });

      return { ok: true, code: 200, ride: updatedRide };
    });

    if (!result.ok) {
      return res.status(result.code).json({ ok: false, message: result.message });
    }

    res.json({ ok: true, ride: result.ride });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Offer accept hata", error: String(e) });
  }
});

/* =========================
   RIDES (DRIVER)
========================= */

// Sürücü: kendi aldığı ride'lar
app.get("/rides/driver/my", driverAuth, async (req, res) => {
  try {
    const rides = await prisma.rideRequest.findMany({
      where: { driverId: req.driverId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ ok: true, rides });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Driver rides my hata", error: String(e) });
  }
});

// Sürücü: ride status güncelle
app.post("/rides/status", driverAuth, async (req, res) => {
  try {
    const { rideId, status } = req.body;
    if (!rideId || !status) {
      return res.status(400).json({ ok: false, message: "rideId ve status gerekli." });
    }

    if (!ALLOWED_RIDE_STATUS.has(String(status))) {
      return res.status(400).json({
        ok: false,
        message: "Geçersiz status.",
      });
    }

    const id = Number(rideId);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "rideId sayı olmalı." });
    }

    const updated = await prisma.rideRequest.updateMany({
      where: { id, driverId: req.driverId },
      data: { status: String(status) },
    });

    if (updated.count === 0) {
      return res.status(403).json({ ok: false, message: "Bu ride sana ait değil veya bulunamadı." });
    }

    const ride = await prisma.rideRequest.findUnique({ where: { id } });
    res.json({ ok: true, ride });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Status update hata", error: String(e) });
  }
});

/* =========================
   404 + ERROR HANDLERS
========================= */
app.use((req, res) => {
  res.status(404).json({ ok: false, message: "Route bulunamadı", path: req.path });
});

app.use((err, req, res, next) => {
  res.status(500).json({ ok: false, message: "Server error", error: String(err?.message || err) });
});

/* =========================
   START
========================= */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
});

// Render restart/shutdown sırasında Prisma'yı temiz kapat
async function shutdown(signal) {
  try {
    console.log(`🔻 ${signal} received, shutting down...`);
    await prisma.$disconnect();
  } catch (e) {
    console.error("Shutdown error:", e);
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  console.error("🔥 uncaughtException:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("🔥 unhandledRejection:", reason);
});
