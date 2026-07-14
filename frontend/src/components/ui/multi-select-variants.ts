import { cva } from "class-variance-authority";

/** Shared badge styling for the multi-select rendering layer. */
export const multiSelectVariants = cva(
  "m-1 transition-all duration-300 ease-in-out",
  {
    variants: {
      variant: {
        default: "border-foreground/10 text-foreground bg-card hover:bg-card/80",
        secondary:
          "border-foreground/10 bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        inverted: "inverted",
      },
      badgeAnimation: {
        bounce: "hover:-translate-y-px hover:scale-[1.02]",
        pulse: "hover:animate-pulse",
        wiggle: "hover:animate-wiggle",
        fade: "hover:opacity-80",
        slide: "hover:translate-x-1",
        none: "",
      },
    },
    defaultVariants: { variant: "default", badgeAnimation: "bounce" },
  },
);
