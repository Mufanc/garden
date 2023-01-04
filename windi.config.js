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
	preflight: true,
    plugins: [
        require('windicss/plugin/typography')
    ]
}