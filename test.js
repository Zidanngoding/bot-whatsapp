const { createCanvas } = require("canvas");
const sharp = require("sharp");

async function test() {
  try {
    const canvas = createCanvas(512, 512);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = "black";
    ctx.font = "30px Arial";
    ctx.fillText("Halo dunia", 100, 256);
    const buffer = canvas.toBuffer("image/png");
    const webp = await sharp(buffer).webp().toBuffer();
    console.log("Canvas and sharp work, buffer length:", webp.length);
  } catch (error) {
    console.error("Error:", error);
  }
}

test();
