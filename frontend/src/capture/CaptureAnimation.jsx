import {useEffect, useRef} from 'react';
import {playCaptureAnimation} from './recognitionAnimation';

/*
* Full-screen overlay that plays the recognition animation for one capture.
* capture: {frame, normalised, quad, scores} or null to show nothing.
* */
export default function CaptureAnimation({capture, onClose}) {
    const containerRef = useRef(null);
    // kept in a ref so a new onClose each render doesn't restart the animation
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!capture || !containerRef.current) return undefined;
        return playCaptureAnimation(containerRef.current, {
            ...capture, onClose: () => onCloseRef.current?.(),
        });
    }, [capture]);

    if (!capture) return null;
    return <div ref={containerRef}/>;
}
