import { ImgHTMLAttributes } from "react";
import { useMediaUrl } from "@/hooks/useMediaUrl";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | null | undefined;
};

export const AuthenticatedImage = ({ src, ...props }: Props) => {
  const resolvedSrc = useMediaUrl(src);
  if (!resolvedSrc) return null;
  return <img src={resolvedSrc} {...props} />;
};
