//
//  Persistence.swift
//  TodoAppSwiftUI3
//
//  Created by Roman Luzgin on 21.06.21.
//
import { Item, ItemType } from "./Models";
import { ViewContext, HasId } from "@tswift/coredata";

export class PersistenceController {
  static get shared() {
    return shared;
  }
  static get preview() {
    if (_preview) {
      return _preview;
    }
    _preview = new PersistenceController(true);
    const viewContext = _preview.container.viewContext;
    for (let i = 0; i < 10; i++) {
      const newItem = Item(viewContext);
      newItem.timestamp = new Date();
      newItem.dueDate = new Date();
      newItem.category = "Business";
      newItem.toDoText =
        "You need to do this task in order to proceed with the next one";
    }
    try {
      viewContext.save();
    } catch (e) {
      // Replace this implementation with code to handle the error appropriately.
      // fatalError() causes the application to generate a crash log and terminate. You should not use this function in a shipping application, although it may be useful during development.
      // let nsError = error as NSError
      // fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
    }
    return _preview;
  }

  container = {
    viewContext: new ViewContext(),
  };

  constructor(inMemory = false) {
    // container = NSPersistentContainer(name: "TodoAppSwiftUI3")
    // if inMemory {
    //     container.persistentStoreDescriptions.first!.url = URL(fileURLWithPath: "/dev/null")
    // }
    // container.loadPersistentStores(completionHandler: { (storeDescription, error) in
    //     if let error = error as NSError? {
    //         // Replace this implementation with code to handle the error appropriately.
    //         // fatalError() causes the application to generate a crash log and terminate. You should not use this function in a shipping application, although it may be useful during development.
    //         /*
    //         Typical reasons for an error here include:
    //         * The parent directory does not exist, cannot be created, or disallows writing.
    //         * The persistent store is not accessible, due to permissions or data protection when the device is locked.
    //         * The device is out of space.
    //         * The store could not be migrated to the current model version.
    //         Check the error message to determine what the actual problem was.
    //         */
    //         fatalError("Unresolved error \(error), \(error.userInfo)")
    //     }
    // })
  }
}
const shared = new PersistenceController();
let _preview: PersistenceController;
