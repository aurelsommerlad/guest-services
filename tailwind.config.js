/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9eaff",
          200: "#bcdaff",
          300: "#8ec2ff",
          400: "#5aa2ff",
          500: "#2f7dff",
          600: "#175fe0",
          700: "#144bb3",
          800: "#153f8c",
          900: "#173770",
        },
      },
    },
  },
  plugins: [],
};
