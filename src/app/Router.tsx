import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AdminPage from "../pages/AdminPage";
import PaymentPage from "../pages/PaymentPage";
import PurchasePage from "../pages/PurchasePage";

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PurchasePage />} />
        <Route path="/payment" element={<PaymentPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
