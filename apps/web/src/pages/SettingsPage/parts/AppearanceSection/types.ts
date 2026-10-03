export type AppearanceSectionProps = {
  defaultView: "board" | "list";
  textSize: "comfortable" | "large";
  onDefaultViewChange: (view: "board" | "list") => void;
  onTextSizeChange: (size: "comfortable" | "large") => void;
};
