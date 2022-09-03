import { Set, CountSet } from "@tswift/util";
import { Bindable } from "@tswift/util";
import { HasId, hasId, SelectionType } from "./types";

type Identity = HasId | string;

export const id = <V extends Identity>(
  v: V
): V extends HasId ? HasId["id"] : string => (hasId(v) ? v.id : v + "");

export type Selection<T extends Identity> = Bindable<SelectionType> & {
  isSelected(v: T | string): boolean;
  toggle(v: T | string): void;
};

export const createSelection = <V extends Identity>(
  selection: Bindable<SelectionType>
): Selection<V> => {
  return Object.assign(selection, {
    isSelected(v: Identity): boolean {
      const answer = selection();
      if (answer instanceof CountSet) {
        return answer.has(id(v));
      }
      return answer === id(v);
    },
    toggle(v: Identity): void {
      const answer = selection();
      const vid = id(v);
      if (answer instanceof CountSet) {
        if (answer.has(vid)) {
          answer.delete(vid);
          selection(Set(answer));
          return;
        }
        selection(Set([...answer, vid]));
        return;
      }
      selection(v === answer ? null : vid);
    },
  });
};