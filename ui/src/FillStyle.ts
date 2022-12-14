import { swifty } from "@tswift/util";

export class FillStyleClass {
  toFill() {
    return "";
  }
  constructor(public isEOFilled: boolean, public isAntialiased: boolean) {}
}
export type FillStyleType = typeof FillStyleClass;
export const FillStyle = swifty(FillStyleClass);
