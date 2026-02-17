import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

import multer from "multer";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());

// -------------------- HELPERS --------------------
// +90 ile başlayanları TR formatına çekiyoruz, sadece rakam bırakıyoruz
const normPhone = (s) =>
  (s || "")
    .toString()
    .replace(/\D/g, "")
    .replace(/^90/, "");

// Gmail ile mail göndermek için (MAIL_USER / MAIL_PASS .env’de olmalı)
function getMailer() {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) return null;

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });
}

// -------------------- UPLOADS (klasör garanti) --------------------
const uploadsDir = path.resolve("uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

// uploads klasörünü serve edelim (opsiyonel)
app.use("/uploads", express.static(path.resolve("uploads")));

// -------------------- WEB SERVE --------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Not: Bu path senin proje yapına göre değişebilir.
// Eğer /web 404 verirse, web klasörünün gerçek konumuna göre burayı ayarlarız.
const webPath = path.resolve(__dirname, "..", "..", "web");
app.use("/web", express.static(webPath));

// -------------------- HEALTH CHECK (test için) --------------------
app.get("/api/ping", (req, res) => res.json({ ok: true }));

// -------------------- RIDES --------------------
app.post("/api/rides", async (req, res) => {
  try {
    const ride = await prisma.rideRequest.create({
      data: {
        customerName: req.body.customerName || null,
        customerPhone: req.body.customerPhone,
        pickupText: req.body.pickupText,
        dropoffText: req.body.dropoffText || null,
        region: req.body.region,
        note: req.body.note || null,
        status: "NEW",
      },
    });

    return res.json({ ride });
  } catch (e) {
    return res.status(400).json({ error: "Çağrı oluşturulamadı" });
  }
});

app.get("/api/rides", async (req, res) => {
  const rides = await prisma.rideRequest.findMany({
    orderBy: { createdAt: "desc" },
  });
  return res.json({ rides });
});

// -------------------- DRIVERS (admin kayıt) --------------------
app.post("/api/drivers", async (req, res) => {
  try {
    // ✅ kritik fix: normalize (yoksa login/forgot ile eşleşmez)
    const phoneN = normPhone(req.body.phone);

    const driver = await prisma.driver.create({
      data: {
        ...req.body,
        phone: phoneN,
      },
    });

    return res.json({ driver });
  } catch (e) {
    return res.status(400).json({ error: "Sürücü kaydedilemedi" });
  }
});

app.get("/api/drivers", async (req, res) => {
  const drivers = await prisma.driver.findMany({
    orderBy: { createdAt: "desc" },
  });
  return res.json({ drivers });
});

// -------------------- DRIVER REGISTER (başvuru) --------------------
app.post(
  "/api/driver-register",
  upload.fields([{ name: "photo1" }, { name: "photo2" }, { name: "photo3" }]),
  async (req, res) => {
    try {
      const { name, surname, phone, password, address } = req.body;

      if (!name || !surname || !phone || !password || !address) {
        return res.status(400).json({ success: false, error: "Eksik bilgi" });
      }

      const phoneN = normPhone(phone);
      const hashed = await bcrypt.hash(password, 10);

      const p1 = req.files?.photo1?.[0]?.filename || null;
      const p2 = req.files?.photo2?.[0]?.filename || null;
      const p3 = req.files?.photo3?.[0]?.filename || null;

      await prisma.driver.create({
        data: {
          fullName: `${name} ${surname}`,
          phone: phoneN,
          password: hashed,
          address,
          region: "pending",
          plate: "",
          isActive: false,
        },
      });

      // mail at (opsiyonel)
      const transporter = getMailer();
      if (transporter) {
        await transporter.sendMail({
          from: process.env.MAIL_USER,
          to: process.env.MAIL_USER,
          subject: "Yeni Sürücü Başvurusu",
          html: `
            <h3>Yeni Başvuru</h3>
            <b>İsim:</b> ${name} ${surname}<br>
            <b>Telefon:</b> ${phone}<br>
            <b>Adres:</b> ${address}<br>
            <b>Foto:</b> ${[p1, p2, p3].filter(Boolean).join(", ")}
          `,
        });
      }

      return res.json({ success: true });
    } catch (err) {
      console.log(err);
      return res.status(500).json({ success: false });
    }
  }
);

// -------------------- DRIVER LOGIN --------------------
app.post("/api/driver-login", async (req, res) => {
  try {
    const { phone, password } = req.body;
    const phoneN = normPhone(phone);

    const driver = await prisma.driver.findUnique({
      where: { phone: phoneN },
    });

    if (!driver || !driver.password) return res.json({ success: false });

    const ok = await bcrypt.compare(password, driver.password);
    if (!ok) return res.json({ success: false });

    if (!driver.isActive) {
      return res.json({ success: false, message: "Admin onayı bekleniyor" });
    }

    return res.json({ success: true, driverId: driver.id });
  } catch (e) {
    return res.status(500).json({ success: false });
  }
});

// -------------------- DRIVER FORGOT (şifre sıfırlama talebi) --------------------
app.post("/api/driver-forgot", async (req, res) => {
  try {
    const { phone } = req.body;
    const phoneN = normPhone(phone);

    const driver = await prisma.driver.findUnique({ where: { phone: phoneN } });
    if (!driver) return res.json({ success: false });

    const transporter = getMailer();
    if (transporter) {
      await transporter.sendMail({
        from: process.env.MAIL_USER,
        to: process.env.MAIL_USER,
        subject: "Şifre Sıfırlama Talebi",
        html: `
          <h3>Şifre Sıfırlama Talebi</h3>
          Telefon: ${phone}<br>
          Sürücü: ${driver.fullName}<br>
          <p>Bu sürücü şifre sıfırlama talebi oluşturdu. Admin olarak yeni şifre belirleyip iletebilirsin.</p>
        `,
      });
    }

    return res.json({ success: true });
  } catch (e) {
    console.log(e);
    return res.status(500).json({ success: false });
  }
});

// -------------------- ASSIGNMENTS --------------------
app.get("/api/assignments", async (req, res) => {
  const items = await prisma.assignment.findMany({
    include: { ride: true, driver: true },
    orderBy: { sentAt: "desc" },
  });
  return res.json({ items });
});

app.get("/api/assignments/:id", async (req, res) => {
  const assignment = await prisma.assignment.findUnique({
    where: { id: req.params.id },
    include: { ride: true, driver: true },
  });

  if (!assignment) return res.status(404).json({ error: "Atama bulunamadı" });
  return res.json({ assignment });
});

// Ride -> Driver assign
app.post("/api/rides/:rideId/assign/:driverId", async (req, res) => {
  const { rideId, driverId } = req.params;

  const ride = await prisma.rideRequest.findUnique({ where: { id: rideId } });
  if (!ride) return res.status(404).json({ error: "Ride bulunamadı" });

  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) return res.status(404).json({ error: "Driver bulunamadı" });

  const assignment = await prisma.assignment.create({
    data: { rideId, driverId },
  });

  await prisma.rideRequest.update({
    where: { id: rideId },
    data: { status: "ASSIGNED" },
  });

  const link = `http://localhost:4000/web/driver.html?id=${assignment.id}`;
  return res.json({ assignment, link });
});

// accept / arrived / start / complete (status akışı)
app.post("/api/assignments/:id/accept", async (req, res) => {
  const assignment = await prisma.assignment.update({
    where: { id: req.params.id },
    data: { status: "ACCEPTED", respondedAt: new Date() },
  });

  await prisma.rideRequest.update({
    where: { id: assignment.rideId },
    data: { status: "ACCEPTED" },
  });

  return res.json({ ok: true });
});

app.post("/api/assignments/:id/arrived", async (req, res) => {
  const assignment = await prisma.assignment.update({
    where: { id: req.params.id },
    data: { status: "ARRIVED" },
  });
  await prisma.rideRequest.update({
    where: { id: assignment.rideId },
    data: { status: "ARRIVED" },
  });
  return res.json({ ok: true });
});

app.post("/api/assignments/:id/start", async (req, res) => {
  const assignment = await prisma.assignment.update({
    where: { id: req.params.id },
    data: { status: "STARTED" },
  });
  await prisma.rideRequest.update({
    where: { id: assignment.rideId },
    data: { status: "STARTED" },
  });
  return res.json({ ok: true });
});

app.post("/api/assignments/:id/complete", async (req, res) => {
  const assignment = await prisma.assignment.update({
    where: { id: req.params.id },
    data: { status: "COMPLETED" },
  });
  await prisma.rideRequest.update({
    where: { id: assignment.rideId },
    data: { status: "COMPLETED" },
  });
  return res.json({ ok: true });
});

// -------------------- START SERVER (en sonda) --------------------
app.listen(4000, "0.0.0.0", () => {
  console.log("Backend running on port 4000");
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Backend running on port " + PORT);
});
