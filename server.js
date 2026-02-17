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
  // JWT_SECRET varlığı yukarıda kontrol ediliyor
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
  "ACCEPTED",
  "ARRIVING",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELED",
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
   RIDES (CUSTOMER)
========================= */
app.post("/rides/create", auth, async (req, res) => {
  try {
    const { pickupText, dropoffText } = req.body;
    if (!pickupText) return res.status(400).json({ ok: false, message: "pickupText gerekli." });

    const ride = await prisma.rideRequest.create({
      data: {
        customerId: req.userId,
        pickupText,
        dropoffText: dropoffText || null,
        status: "OPEN",
      },
    });

    res.json({ ok: true, ride });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Ride create hata", error: String(e) });
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
   RIDES (DRIVER)
========================= */
app.get("/rides/open", driverAuth, async (req, res) => {
  try {
    const rides = await prisma.rideRequest.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ ok: true, rides });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Rides open hata", error: String(e) });
  }
});

app.post("/rides/accept", driverAuth, async (req, res) => {
  try {
    const { rideId } = req.body;
    if (!rideId) return res.status(400).json({ ok: false, message: "rideId gerekli." });

    const id = Number(rideId);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "rideId sayı olmalı." });
    }

    const updated = await prisma.rideRequest.updateMany({
      where: { id, status: "OPEN", driverId: null },
      data: { driverId: req.driverId, status: "ACCEPTED" },
    });

    if (updated.count === 0) {
      return res.status(409).json({ ok: false, message: "Çağrı zaten alınmış veya OPEN değil." });
    }

    const ride = await prisma.rideRequest.findUnique({ where: { id } });
    res.json({ ok: true, ride });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Kabul edilemedi", error: String(e) });
  }
});

app.post("/rides/status", driverAuth, async (req, res) => {
  try {
    const { rideId, status } = req.body;
    if (!rideId || !status) {
      return res.status(400).json({ ok: false, message: "rideId ve status gerekli." });
    }

    if (!ALLOWED_RIDE_STATUS.has(String(status))) {
      return res.status(400).json({
        ok: false,
        message:
          "Geçersiz status. Allowed: OPEN, ACCEPTED, ARRIVING, IN_PROGRESS, COMPLETED, CANCELED",
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
