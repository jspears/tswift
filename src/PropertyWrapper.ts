import { UseAnimation } from "./Animation";
import { View } from "./View/index";


export const Namespace = Object.assign((target: Object, propertyKey: string) => {

}, { ID: 'ID' });

export function FocusState(target: Object, propertyKey: PropertyKey) {

}
export function State(target: Object, propertyKey: PropertyKey) {
     console.log("first(): called");
}

export function Environment(property: string) {

     return function (target: Object, propertyKey: PropertyKey) {
          console.log("Environment(): called");

     }
}
// @FetchRequest(
//     sortDescriptors: [NSSortDescriptor(keyPath: \Item.dueDate, ascending: false)],
//     animation: .default)
interface Sort {
     keyPath?: string;
     ascending?: boolean;
}

export function FetchRequest(req: { sortDescriptors: Sort[], animation?: UseAnimation }) {
     return function (target: Object, propertyKey: PropertyKey) {
          console.log("Environment(): called");
     }

}

export function Binding(target: View, property: PropertyKey) {

}


export function AppStorage(key: string) {
     return function AppStorage$(target: Object, property: PropertyKey) {

     }
}