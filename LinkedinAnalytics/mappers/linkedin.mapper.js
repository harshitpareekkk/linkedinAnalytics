export const mapLinkedInToMonday = (
  post,
  analytics
) => ({
  postId: post.id,
  title: post.text.slice(0, 80),
  text: post.text,
  createdAt: post.createdAt,
  postUrl: post.url,
  analytics,
});
