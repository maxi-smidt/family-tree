import { ImgHTMLAttributes, ReactNode } from "react";
import { useMediaUrl } from "@/hooks/useMediaUrl";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | null | undefined;
  fallback?: ReactNode;
};

export const AuthenticatedImage = ({ src, fallback = null, ...props }: Props) => {
  const resolvedSrc = useMediaUrl(src);
  if (!resolvedSrc) return <>{fallback}</>;
  return <img src={resolvedSrc} {...props} />;
};
