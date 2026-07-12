import styles from "./NewsCard.module.css";

export type NewsCardProps = {
  title: string;
  source: string;
  thumbnail: string;
};

function NewsCard({ title, source, thumbnail }: NewsCardProps) {
  return (
    <article className={styles.card}>
      <img className={styles.thumbnail} src={thumbnail} alt={`${source} 자료 이미지`} />
      <div className={styles.content}>
        <p className={styles.source}>{source}</p>
        <h3 className={styles.title}>{title}</h3>
      </div>
    </article>
  );
}

export default NewsCard;
