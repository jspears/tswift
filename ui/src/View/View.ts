import { UUID, Void } from "@tswift/util";
import { h, VNode, Fragment } from "preact";
import { HasId } from "../List/types";

export class View implements HasId {
  id:string ='';

  _children: View[] = [];

  _parent?: View;

  set children(children) {
    children?.forEach((v) => (v.parent = this));
    this._children = children;
  }

  get children(): View[] {
    return this._children;
  }

  set parent(v: View | undefined) {
    if (this._parent && v !== this._parent) {
      console.warn(
        `${this?.constructor?.name} was assigned a different parent, this should not happen new '${v?.constructor?.name}' old '${this._parent?.constructor?.name}'`
      );
    }
    this._parent = v;
    this.init();
  }

  get parent(): View | undefined {
    return this._parent;
  }

  init() {}

  render(): VNode<any> {
    if (this.children) {
      return h(Fragment, {}, ...this.children.map((v) => v.render?.()));
    }
    return h(Fragment, {});
  }
}

export type Content = () => View;
