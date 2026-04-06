const express = require("express");
const multer = require("multer");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));

// Schemas
const User = mongoose.model("User", new mongoose.Schema({
  email: String,
  password: String
}));

const File = mongoose.model("File", new mongoose.Schema({
  filename: String,
  url: String,
  key: String,
  userId: String,
  uploadedAt: { type: Date, default: Date.now }
}));

// Auth middleware
const auth = (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};

// AWS S3
const s3 = new S3Client({
  region: process.env.REGION,
  credentials: {
    accessKeyId: process.env.ACCESS_KEY,
    secretAccessKey: process.env.SECRET_KEY
  }
});

// Multer
const upload = multer({ storage: multer.memoryStorage() });

// Signup
app.post("/signup", async (req, res) => {
  const { email, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  await new User({ email, password: hashed }).save();
  res.json({ message: "User created" });
});

// Login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });

  if (!user) return res.json({ error: "User not found" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.json({ error: "Wrong password" });

  const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);
  res.json({ token });
});
// Reset Password
app.post("/reset-password", async (req, res) => {
  const { email, newPassword } = req.body;

  const user = await User.findOne({ email });
  if (!user) return res.json({ error: "User not found" });

  const hashed = await bcrypt.hash(newPassword, 10);
  user.password = hashed;
  await user.save();

  res.json({ message: "Password updated successfully" });
});
// Upload
app.post("/upload", auth, upload.single("file"), async (req, res) => {
  const key = uuidv4() + "-" + req.file.originalname;

  await s3.send(new PutObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: key,
    Body: req.file.buffer
  }));

  const url = `https://${process.env.BUCKET_NAME}.s3.${process.env.REGION}.amazonaws.com/${key}`;

  await new File({
    filename: req.file.originalname,
    url,
    key,
    userId: req.userId
  }).save();

  res.json({ url });
});

// Get files
app.get("/files", auth, async (req, res) => {
  const files = await File.find({ userId: req.userId });
  res.json(files);
});

// Delete
app.delete("/delete/:id", auth, async (req, res) => {
  const file = await File.findById(req.params.id);

  await s3.send(new DeleteObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: file.key
  }));

  await File.findByIdAndDelete(req.params.id);
  res.json({ message: "Deleted" });
});

app.listen(3000, () => console.log("Server running"));