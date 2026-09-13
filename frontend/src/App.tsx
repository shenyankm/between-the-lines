import { Route, Routes } from "react-router";
import { Home, Saves } from "./features/Home";
import { Play } from "./features/game/Play";
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/saves" element={<Saves />} />
      <Route path="/play/:id" element={<Play />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
