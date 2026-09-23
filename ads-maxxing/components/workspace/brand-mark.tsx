import Image from "next/image";

type BrandMarkProps = {
  size?: number;
  animated?: boolean;
  className?: string;
};

export function BrandMark({ size = 34, animated = false, className = "" }: BrandMarkProps) {
  return (
    <span
      className={`brand-mark ${animated ? "brand-mark-animated" : ""} ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Image src="/brand/balloon-a.png" alt="" width={size} height={size} sizes={`${size}px`} />
    </span>
  );
}

export function Wordmark({ animated = false, className = "" }: { animated?: boolean; className?: string }) {
  return (
    <span className={`wordmark ${className}`.trim()}>
      <BrandMark animated={animated} />
      <span className="wordmark-name">ads-maxxing</span>
    </span>
  );
}
