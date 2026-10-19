// Desktop entry point. The phone and web builds start from ../index.js through
// Expo's registerRootComponent; the desktop engine looks the app up by the name
// in app.json, so register it under that name directly.
import { AppRegistry } from "react-native";
import App from "../src/App";
import appJson from "./app.json";

AppRegistry.registerComponent(appJson.name, () => App);
