
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAxLu0J0AuuF3evgDyPM1UFYrV_FrO71Eo",
  authDomain: "arquibancada-imports.firebaseapp.com",
  projectId: "arquibancada-imports",
  storageBucket: "arquibancada-imports.firebasestorage.app",
  messagingSenderId: "309684918456",
  appId: "1:309684918456:web:229d754d3b10a8ea723c4d"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export default app;
