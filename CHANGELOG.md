# Changelog

## [0.1.0](https://github.com/blbaker/daily-dispatch/compare/v0.1.0...v0.1.0) (2026-10-20)


### ⚠ BREAKING CHANGES

* **release:** publish the package as @blbaker/daily-dispatch

### Features

* add README, tsconfig, and backend type deps ([53ff8e4](https://github.com/blbaker/daily-dispatch/commit/53ff8e4307c8e994ba0c8dbecb762d96f3bf5971))
* **app:** add a settings store that saves locally and syncs the podcast section ([fa3e8af](https://github.com/blbaker/daily-dispatch/commit/fa3e8afe5e9d27ad48f6b357edf024050712dd58))
* **app:** add the Settings screen as a third tab ([9a50e8e](https://github.com/blbaker/daily-dispatch/commit/9a50e8e9bdd216ac1743030c9ea49c79c3c5c09e))
* **app:** push notifications for iOS, Android, web and desktop ([b61b588](https://github.com/blbaker/daily-dispatch/commit/b61b588057283613f214034bc03987fee3d97845))
* **app:** read the API URL and key from Settings on every request ([3447803](https://github.com/blbaker/daily-dispatch/commit/344780301f8a9bc56928e81d4a9f37035fbda0b8))
* **app:** run the app on macOS, Linux and Windows through Impeller ([c18a3fb](https://github.com/blbaker/daily-dispatch/commit/c18a3fbb56e5e4755273866d50cf1c835b6150a2))
* **backend:** add GET/PUT /settings for notification and daily podcast prefs ([a282a0e](https://github.com/blbaker/daily-dispatch/commit/a282a0e9b9bfb93fcbd2b5abcd0c91949c5d61b6))
* **backend:** add media bucket, push SSM parameters and receipt schedule to the stack ([a9c8586](https://github.com/blbaker/daily-dispatch/commit/a9c858681f81faa0931d41a70f0bcfeaced1fb1e))
* **backend:** add POST /episodes with a presigned upload and episode fan-out ([b781939](https://github.com/blbaker/daily-dispatch/commit/b781939c0373625f5829034475f98f43ef5e6dd5))
* **backend:** add the PushProvider seam with expo and webpush adapters ([3bfc966](https://github.com/blbaker/daily-dispatch/commit/3bfc96601e55ce1f5db3b84b0a1dc0a22e770755))
* **backend:** check Expo receipts hourly and add push test and config routes ([d178f69](https://github.com/blbaker/daily-dispatch/commit/d178f69ff998a9f210ca5ea2737206cfafca7e7a))
* **backend:** fan out finished editions and serve /notifications/since ([8fb7dd9](https://github.com/blbaker/daily-dispatch/commit/8fb7dd9059995e6e28323c952829d55ae9a7e1cd))
* **backend:** log Expo receipt errors other than DeviceNotRegistered ([e7d6204](https://github.com/blbaker/daily-dispatch/commit/e7d62040d96d6f275923e4eb87b6a226a351dd12))
* **backend:** re-read push credentials every 15 minutes ([15d6622](https://github.com/blbaker/daily-dispatch/commit/15d6622423296afcef986baef4274351f683a564))
* **backend:** register and unregister push devices ([417421c](https://github.com/blbaker/daily-dispatch/commit/417421cf9d5c9ea8439f76ca026917d32f4e301f))
* **ci:** add a third-party notices generator for the app builds ([93301ec](https://github.com/blbaker/daily-dispatch/commit/93301ec7815ddf6d24fed91aea1bb01073329681))
* **package:** add npm publishing metadata to daily-dispatch ([88d871b](https://github.com/blbaker/daily-dispatch/commit/88d871b158b6a1370ff97d87b8db4f4ce2f1e64b))
* **podcast:** add `podcast run --if-due` for the optional daily episode ([de65a21](https://github.com/blbaker/daily-dispatch/commit/de65a214aae5e73804aa65851f85d4cc1565f714))
* **podcast:** add `schedule install|uninstall|status` for the daily job ([1fc844f](https://github.com/blbaker/daily-dispatch/commit/1fc844f4d330d2eae7c07e78caa9a0d6134af207))
* **podcast:** add google, polly, azure and local voice providers ([62a472c](https://github.com/blbaker/daily-dispatch/commit/62a472c87fc61e2884e89a812f28489183d83b81))
* **podcast:** add the daily-dispatch package with writer and voice adapters ([d35a1c8](https://github.com/blbaker/daily-dispatch/commit/d35a1c84853aa5a3d1d9c98e0993eb15cc0f9760))
* **podcast:** upload each new episode to the backend ([f108ecf](https://github.com/blbaker/daily-dispatch/commit/f108ecf3d04e56abd06009df73a7fd74ebe913af))
* **release:** add metadata, tarball and rehearsal gates for npm ([8e09c47](https://github.com/blbaker/daily-dispatch/commit/8e09c4744f47634607c8b85568890a3a66414c4e))
* **release:** publish the package as @blbaker/daily-dispatch ([37fab52](https://github.com/blbaker/daily-dispatch/commit/37fab52adf059ad26026e66fb81391979f8a2057))
* **release:** publish the package as @blbaker/daily-dispatch ([1630053](https://github.com/blbaker/daily-dispatch/commit/1630053ee458ecb617e0df599829e0d1d76b8637))


### Bug Fixes

* .gitignore negation pattern didn't match .env.example ([86acffa](https://github.com/blbaker/daily-dispatch/commit/86acffa4955571842f76c1584579c307cd10828b))
* **app:** keep expo-notifications out of the desktop bundle ([7fd347d](https://github.com/blbaker/daily-dispatch/commit/7fd347d005c0acf65fac71f854ad52e8382748e1))
* **backend:** grant the API only put and read on episode audio ([4762af3](https://github.com/blbaker/daily-dispatch/commit/4762af372b339c9798c9d23bd3b839a226b1faf8))
* **ci:** cover the native packages the first CI run found without license data ([2d61fd4](https://github.com/blbaker/daily-dispatch/commit/2d61fd4612e92085e5f5ca5c8021fec161b69079))
* **ci:** fail the notices run when a section lists nothing ([eb6000c](https://github.com/blbaker/daily-dispatch/commit/eb6000ce2244c1bec0529bd39dbcba449f78e08e))
* **ci:** fix the Android and iOS failures from the first CI run ([0f8eebe](https://github.com/blbaker/daily-dispatch/commit/0f8eebefcf125ea07c9d29ab88302a906b8bd4c3))
* **ci:** read apksigner 37 output and keep the e-ink bundle separate in CI ([a218037](https://github.com/blbaker/daily-dispatch/commit/a21803717961e17d14abd1a4832ae8b5176b8ae6))
* **desktop:** give the push adapter an Impeller stub so the desktop bundle resolves ([7c1d311](https://github.com/blbaker/daily-dispatch/commit/7c1d311d281d16ce0f1d4a10990035f1e0b38faf))
* **desktop:** move to react-native-impeller-platform 0.3.1 and drop the transparent-colour shim ([b6ae1e9](https://github.com/blbaker/daily-dispatch/commit/b6ae1e91efc722c9a2e5998b852bcf10b6fba197))
* **desktop:** write a real zip on Windows when run from Git Bash ([c6cee7c](https://github.com/blbaker/daily-dispatch/commit/c6cee7c336387fd7703fd27d8be136b460e2506c))
* **release:** let the GitHub Pages deploy job hold an OIDC token ([2f40317](https://github.com/blbaker/daily-dispatch/commit/2f40317d9c29558f90aa00f8cfa5c7475a02cb13))
* **release:** limit the workflow policy to registry and infra writes ([8700b4f](https://github.com/blbaker/daily-dispatch/commit/8700b4ff0bf2b3d9958aa0ae31a3bcba4d9b453e))
* remove personal references from code, comments and tests ([162474c](https://github.com/blbaker/daily-dispatch/commit/162474ce2bbc17423479db78de1bd1750397099d))


### Build System

* **release:** version the npm package with release-please ([1611d98](https://github.com/blbaker/daily-dispatch/commit/1611d98119fa133dfd02a8223f39dd818e1d575b))
