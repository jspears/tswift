import { View, Viewable } from "./View";
import type { Content } from "./View";
import { fromKey, swifty } from "@tswift/util";
import { AlignmentKey, Alignment } from "./Edge";
import type { Num } from "@tswift/util";
import { Color, ColorKey } from "./Color";
import { h } from "preact";
import { CSSProperties } from "./types";
import { unitFor } from "./unit";

export interface StackOptions {
  alignment?: AlignmentKey;
  spacing?: Num;
  content?: Content;
  color?: ColorKey;
}

interface FrameOptions {
  maxWidth?: Num;
  maxHeight?: Num;
  height?: Num;
  width?: Num;
  alignment?: AlignmentKey;
}

class StackClass extends Viewable<StackOptions> {
  protected style: CSSProperties = {
    display: "grid",
    // width: '100%',
    // height: '100%',
  };
  constructor(...views: View[]);
  constructor(config: StackOptions, ...views: View[]);
  constructor(config?: StackOptions | View, ...views: View[]) {
    super(config, ...views);

    if (this.config?.alignment) {
      const alignment = fromKey(
        Alignment,
        this.config.alignment as AlignmentKey
      );
      if (this.config.spacing) {
        Object.assign(this.style, { gridRowGap: unitFor(this.config.spacing) });
      }
      switch (alignment) {
        case Alignment.leading:
          Object.assign(this.style, { justifyContent: "start" });
          break;
        case Alignment.trailing:
          Object.assign(this.style, { justifyContent: "end" });

        case Alignment.center:
          Object.assign(this.style, { justifyContent: "center" });
      }
      if (alignment == Alignment.leading) {
      } else alignment?.apply(this.style);
    }
  }

  render() {
    return h("div", { style: this.asStyle(this.style) }, super.render());
  }
}

class VStackClass extends StackClass {
  style: CSSProperties = Object.assign(this.style, {
    gridAutoFlow: "row",
  });
}

export const VStack = swifty(VStackClass);
export const LazyVStack = VStack;

class HStackClass extends StackClass {
  style: CSSProperties = Object.assign(this.style, {
    gridAutoFlow: "column",
  });
  
}
export const HStack = swifty(HStackClass);
export const LazyHStack = HStack;

class ZStackClass extends StackClass {}

export const ZStack = swifty(ZStackClass);
export const LazyZStack = ZStack;
