import { Viewable } from './View';
import { Font, FontKey, Weight } from './Font';
import { swifty } from './utilit';
import { Color, ColorKey } from './Color';
import { Dot, KeyOf, KeyOfTypeWithType } from './types';
interface TextConfig {

}
class TextClass extends Viewable<TextConfig> {
    public constructor(private text: string) {
        super();
    }
}


export const Text = swifty(TextClass)