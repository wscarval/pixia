function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", reject);
    image.src = src;
  });
}

// Recorta a área escolhida no editor (em pixels da imagem original) pra um
// quadrado de saída fixo — o círculo é só a máscara visual do editor, o
// arquivo salvo é sempre um quadrado (o backend decide o formato final).
export async function getCroppedImageBlob(imageSrc, cropPixels, outputSize = 512) {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");

  ctx.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    outputSize,
    outputSize
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Não foi possível gerar a imagem recortada."));
    }, "image/png");
  });
}
