// Custom entry: the background sync task must be defined before anything
// else, because Android may start the app headless (no React tree, so
// app/_layout.tsx would never load) just to run it.
import './src/remote/background'
import 'expo-router/entry'
