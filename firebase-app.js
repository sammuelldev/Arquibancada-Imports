import { initializeApp } from "firebase/app";

const firebaseConfig = {
  apiKey: "AIzaSyAxLu0J0AuuF3evgDyPM1UFYrV_FrO71Eo",
  authDomain: "arquibancada-imports.firebaseapp.com",
  projectId: "arquibancada-imports",
  storageBucket: "arquibancada-imports.firebasestorage.app",
  messagingSenderId: "309684918456",
  appId: "1:309684918456:web:229d754d3b10a8ea723c4d"
};

export const useEmulators = import.meta.env?.VITE_USE_FIREBASE_EMULATORS === "true";
const app = initializeApp(useEmulators
  ? { ...firebaseConfig, projectId: "demo-arquibancada", authDomain: "demo-arquibancada.firebaseapp.com", storageBucket: "demo-arquibancada.appspot.com" }
  : firebaseConfig);

export default app;
