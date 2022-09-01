import { Viewable } from './View';
import { swifty } from '@tswift/util';
import { h, Fragment } from 'preact';
class TextClass extends Viewable<string> {
  public constructor(private text: string) {
      super();
  }

  render() {
    return h('span', { style: this.asStyle({display:'block', background:'inherit'}) }, this.text);
  }
}

export const Text = swifty(TextClass);
