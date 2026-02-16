import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/ping", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/driver-forgot", (req, res) => {
  const { phone } = req.body;
  console.log("Forgot request:", phone);
  res.json({ success: true });
});

app.listen(4000, () => {
  console.log("Backend running on port 4000");
});

