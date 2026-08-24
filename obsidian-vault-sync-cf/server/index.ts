export default {
	fetch(request) {
		return new Response(null, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
