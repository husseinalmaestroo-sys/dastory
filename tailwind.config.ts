import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        navy:  '#0F172A',
        royal: '#1E3A8A',
        gold:  '#C8A84B',
        gold2: '#D4AF37',
        cream: '#F8F5EF',
      },
      fontFamily: {
        cairo: ['Cairo', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-gold': 'linear-gradient(135deg, #D4AF37, #C5A059)',
        'gradient-navy': 'linear-gradient(135deg, #0F172A 0%, #1E3A8A 100%)',
      },
    },
  },
  plugins: [],
}

export default config
