module.exports = {
    extract: {
        include: [
            'content/**/*.md', 
            'themes/overlay/layouts/**/*.html'
        ],
        exclude: [
            '.git/**/*',
            'node_modules/**/*'
        ]
    },
    theme: {
        extend: {
          typography: {
                DEFAULT: {
                    css: {
                        '*:not(pre > code *)': {
                            'color': 'var(--content)'
                        },
                        ':is(h1, h2, h3, h4, h5, h6)': {
                            'color': 'var(--primary)'
                        },
                        'a': {
                            'text-decoration': 'none',
                        },
                        'code': {
                            '&::before, &::after': {
                                'display': 'none'
                            }
                        },
                        ':is(strong, code)': {
                            'color': 'inherit'
                        },
                        'pre': {
                            'background-color': 'inherit !important'
                        }
                    },
                },
            },
        },
    },
    plugins: [
        require('windicss/plugin/typography')
    ]
}