import { useCallback, useState } from "react";
import Cropper from "react-easy-crop";
import { ZoomIn } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getCroppedImageBlob } from "@/lib/cropImage";

export default function AvatarCropDialog({ imageSrc, onCancel, onConfirm }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [error, setError] = useState("");

  const handleCropComplete = useCallback((_croppedArea, pixels) => {
    setCroppedAreaPixels(pixels);
  }, []);

  async function handleConfirm() {
    if (!croppedAreaPixels) return;
    setError("");
    try {
      const blob = await getCroppedImageBlob(imageSrc, croppedAreaPixels);
      onConfirm(blob);
    } catch {
      setError("Não foi possível recortar essa imagem.");
    }
  }

  return (
    <Dialog open={Boolean(imageSrc)} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajustar foto</DialogTitle>
          <DialogDescription>
            Arraste pra posicionar e use o zoom pra escolher o recorte.
          </DialogDescription>
        </DialogHeader>

        <div className="relative h-72 w-full overflow-hidden rounded-lg bg-black">
          {imageSrc ? (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleCropComplete}
            />
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <ZoomIn size={16} className="shrink-0 text-muted-foreground" />
          <input
            type="range"
            className="volume-slider w-full"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </div>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!croppedAreaPixels}>
            Usar foto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
