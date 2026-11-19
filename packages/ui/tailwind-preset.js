/**
 * Tailwind preset CARDIY.
 * Màu chính: xanh logo #1f4e9c (brand). Màu phụ pastel: mint, lav, peach, sky, rose.
 * Giữ đồng bộ với bản thiết kế prototype/index.html.
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: { 50: '#eef3fb', 100: '#dce6f6', 200: '#bccfee', 500: '#2f63b8', 600: '#1f4e9c', 700: '#183e7d' },
        mint: { 100: '#e3f4e6', 300: '#a9dcb3', 500: '#6fbf7f', 700: '#3e8a4f' },
        lav: { 100: '#eceefe', 300: '#c3c8fa', 500: '#9aa2f2', 700: '#5b63c7' },
        peach: { 100: '#fff0e0', 300: '#fbd2a6', 500: '#f4ad6a', 700: '#b8692a' },
        sky: { 100: '#e4effd', 300: '#b4d2f7', 500: '#7fb0ef', 700: '#3d75bf' },
        rose: { 100: '#fdeaea', 300: '#f6bfbf', 500: '#ec8a8a', 700: '#b84b4b' },
      },
      borderRadius: {
        card: '22px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(31,78,156,.04), 0 6px 20px rgba(31,78,156,.05)',
      },
    },
  },
};
