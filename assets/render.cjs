// Renders the App Store icon and splash sources from assets/icon.svg.
// Run: node assets/render.cjs && npx capacitor-assets generate --ios
const sharp = require("sharp");
const path = require("path");
const dir = __dirname;
const svg = path.join(dir, "icon.svg");
(async () => {
  await sharp(svg, { density: 144 }).resize(1024, 1024).flatten({ background: "#120f1e" }).removeAlpha().png().toFile(path.join(dir, "icon-only.png"));
  const mark = await sharp(svg, { density: 144 }).resize(640, 640).png().toBuffer();
  for (const name of ["splash.png", "splash-dark.png"]) {
    await sharp({ create: { width: 2732, height: 2732, channels: 3, background: "#120f1e" } })
      .composite([{ input: mark, gravity: "center" }])
      .png()
      .toFile(path.join(dir, name));
  }
  console.log("rendered icon-only.png, splash.png, splash-dark.png");
})();
