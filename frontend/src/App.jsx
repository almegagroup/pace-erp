/*
 * File-ID: 7.6D
 * File-Path: frontend/src/App.jsx
 * Gate: 7
 * Phase: 7
 * Domain: FRONT
 * Purpose: Inject menu authority provider and router
 * Authority: Frontend
 */

import AppRouter from "./router/AppRouter.jsx";
import { MenuProvider } from "./context/MenuProvider.jsx";

function App() {
  return (
    <MenuProvider>
      <AppRouter />
    </MenuProvider>
  );
}

export default App;
