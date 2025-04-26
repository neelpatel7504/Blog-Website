import { Routes, Route } from "react-router-dom";
import { createContext, useEffect, useState } from "react";
import { lookInSession } from "./common/session";
import { Toaster } from "react-hot-toast";

import Navbar from "./components/navbar.component";
import SideNav from "./components/SideNav"; // ✅ Added missing import

import UserAuthForm from "./pages/userAuthForm.page";
import Editor from "./pages/editor.pages";
import HomePage from "./pages/home.page";
import SearchPage from "./pages/search.page";
import PageNotFound from "./pages/404.page";
import ProfilePage from "./pages/profile.page";
import BlogPage from "./pages/blog.page";
import ChangePassword from "./pages/ChangePassword";
import EditProfile from "./pages/EditProfile"; // ✅ change path if needed



export const UserContext = createContext({});

const App = () => {
  const [userAuth, setUserAuth] = useState({});

  useEffect(() => {
    let userInSession = lookInSession("user");
    userInSession
      ? setUserAuth(JSON.parse(userInSession))
      : setUserAuth({ access_token: null });
  }, []);

  return (
    <UserContext.Provider value={{ userAuth, setUserAuth }}>
      <div>
        <Toaster position="top-center" reverseOrder={false} />
        <Routes>
          <Route path="/editor" element={<Editor />} />
          <Route path="/editor/:blog_id" element={<Editor />} />

          <Route path="/" element={<Navbar />}>
            <Route index element={<HomePage />} />
            
            <Route path="settings" element={<SideNav />}>
              <Route path="edit-profile" element={<EditProfile />} />
              <Route path="change-password" element={<ChangePassword />} />
            </Route>

            <Route path="signin" element={<UserAuthForm type="sign-in" />} />
            <Route path="signup" element={<UserAuthForm type="sign-up" />} />
            <Route path="search/:query" element={<SearchPage />} />
            <Route path="user/:id" element={<ProfilePage />} />
            <Route path="blog/:blog_id" element={<BlogPage />} />
            <Route path="*" element={<PageNotFound />} />
          </Route>
        </Routes>
      </div>
    </UserContext.Provider>
  );
};

export default App;
