import type { VNode } from "preact";
import type { View } from "./View";

type CSS = Omit<
  CSSStyleDeclaration,
  | "item"
  | "setProperty"
  | "removeProperty"
  | "getPropertyValue"
  | "getPropertyPriority"
  | "parentRule"
  | number
  | "length"
  | keyof { [Symbol.iterator](): unknown }
>;

export interface HasRender {
  render(): VNode<any>;
}
export interface HasRenderListItem {
  renderListItem(index: number, total: number, children?: View): VNode<any>;
}

export interface ListStyleRenderListItem {
  renderListItem(view: View, index: number, total: number): VNode<any>;
}
export type CSSProperties = Partial<CSS>;
export type TransformFn = (v: View, idx: number, total: number) => VNode<any>;
