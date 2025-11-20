const express = require("express");
const cors = require("cors");
require('dotenv').config()
const app = express();
const port = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Zap Shift is Shifting...😉");
});

app.listen(port, () => {
  console.log(`Zap shift is listening on port ${port}`);
});
