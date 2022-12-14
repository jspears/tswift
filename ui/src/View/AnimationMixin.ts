import { AnimationKey, isBindableState, Animation } from "../Animation";
import type { Bindable } from "@tswift/util";

export class AnimationMixin {
  watch?: Map<string, Bindable<unknown>>;

  animation(type: AnimationKey, t: Bindable<unknown>) {
    if (!isBindableState(t)) {
      return this;
    }
    const scope = t.scope as unknown as typeof this;
    if (this !== scope) {
      scope.animation(type, t);
      return this;
    }
    if (this.watch) {
      const bound = this.watch.get(t.property);
      if (bound && !(bound as any).animated) {
        this.watch.set(t.property, Animation.fromKey(type).tween(bound));
      }
    }
    return this;
  }
}
