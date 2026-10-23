/* firebase-config.js – initialises Firebase (v10 modular SDK via CDN) and exports db + auth */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDbhYUOp2PM3VL1xHiMxZL_IFit2z9yB1E",
  authDomain: "aurelia-bf936.firebaseapp.com",
  projectId: "aurelia-bf936",
  storageBucket: "aurelia-bf936.firebasestorage.app",
  messagingSenderId: "213793732449",
  appId: "1:213793732449:web:bf25378d6e598df50f3720",
  measurementId: "G-EC53GW78XR"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
