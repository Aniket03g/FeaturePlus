"use client";
import Checkbox from "@/components/form/input/Checkbox";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import { ChevronLeftIcon, EyeCloseIcon, EyeIcon } from "@/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import API from "@/api/api";
import { toast } from "react-hot-toast";

export default function SignUpForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [isChecked, setIsChecked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    username: "",
    password: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isChecked) {
      toast.error("Please accept the terms and conditions");
      return;
    }

    try {
      setIsLoading(true);
      const response = await API.post('/auth/signup', formData);
      toast.success("Signup successful!");
      // Store the token if returned
      if (response.data.token) {
        localStorage.setItem("token", response.data.token);
      }
      // Redirect to login
      router.push("/login");
    } catch (error: any) {
      toast.error(error.response?.data?.error || "Failed to sign up");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 lg:w-1/2 w-full overflow-y-auto no-scrollbar">
      <div className="w-full max-w-md sm:pt-10 mx-auto mb-5">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        >
          <ChevronLeftIcon />
          Back to dashboard
        </Link>
      </div>
      
      <div>
        <div className="mb-5 sm:mb-8">
          <h1 className="mb-2 font-semibold text-gray-800 text-title-sm dark:text-white/90 sm:text-title-md">
            Sign Up
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Enter your email and password to sign up!
          </p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="space-y-5">
            {/* <!-- Name --> */}
            <div>
              <Label>
                Name<span className="text-error-500">*</span>
              </Label>
              <Input
                type="text"
                id="name"
                name="name"
                defaultValue={formData.name}
                onChange={handleChange}
                placeholder="Enter your name"
                required
              />
            </div>
            {/* <!-- Email --> */}
            <div>
              <Label>
                Email<span className="text-error-500">*</span>
              </Label>
              <Input
                type="email"
                id="email"
                name="email"
                defaultValue={formData.email}
                onChange={handleChange}
                placeholder="Enter your email"
                required
              />
            </div>
            {/* <!-- Username --> */}
            <div>
              <Label>
                Username<span className="text-error-500">*</span>
              </Label>
              <Input
                type="text"
                id="username"
                name="username"
                defaultValue={formData.username}
                onChange={handleChange}
                placeholder="Choose a username"
                required
              />
            </div>
            {/* <!-- Password --> */}
            <div>
              <Label>
                Password<span className="text-error-500">*</span>
              </Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  name="password"
                  defaultValue={formData.password}
                  onChange={handleChange}
                  placeholder="Enter your password"
                  required
                />
                <button
                  type="button"
                  className="absolute right-4 top-1/2 -translate-y-1/2"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeCloseIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>
            {/* <!-- Terms --> */}
            <div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="terms"
                  checked={isChecked}
                  onChange={(e) => setIsChecked(e.target.checked)}
                  className="w-4 h-4 text-primary-500 border-gray-300 rounded focus:ring-primary-500"
                />
                <label htmlFor="terms" className="text-sm text-gray-500 dark:text-gray-400">
                  I agree to the{" "}
                  <Link href="#" className="text-primary-500 hover:text-primary-600">
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link href="#" className="text-primary-500 hover:text-primary-600">
                    Privacy Policy
                  </Link>
                </label>
              </div>
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center justify-center w-full px-6 py-3 text-sm font-medium text-white transition-colors rounded-lg bg-primary-500 hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 disabled:opacity-50"
            >
              {isLoading ? "Signing up..." : "Sign Up"}
            </button>
            <p className="text-sm text-center text-gray-500 dark:text-gray-400">
              Already have an account?{" "}
              <Link href="/login" className="text-primary-500 hover:text-primary-600">
                Sign in
              </Link>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
