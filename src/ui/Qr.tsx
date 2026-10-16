import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function Qr({ value, size = 180, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: size * 2, color: { dark: '#1B1F3B', light: '#FFFFFF' } })
      .then(setSrc).catch(() => setSrc(null));
  }, [value, size]);
  return src
    ? <img className="qr" src={src} width={size} height={size} alt={label} />
    : <div className="qr qr-empty" style={{ width: size, height: size }} />;
}
