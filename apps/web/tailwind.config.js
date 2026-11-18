export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Open Sans"', 'Inter', 'system-ui', 'sans-serif']
      },
      colors: {
        soft: {
          bg: 'var(--bg)',
          card: 'var(--card)',
          ink: 'var(--ink)',
          muted: 'var(--mut)',
          line: 'var(--line)',
          success: '#82d616',
          danger: '#ea0606',
          warning: '#fb8c00',
          cyan: '#17c1e8',
          blue: '#2152ff'
        }
      },
      boxShadow: {
        soft: 'var(--sh)',
        icon: '0 4px 7px rgba(33, 82, 255, 0.3)',
        nav: '0 3px 8px rgba(0, 0, 0, 0.08)'
      },
      borderRadius: {
        card: '16px'
      }
    }
  },
  plugins: []
};
